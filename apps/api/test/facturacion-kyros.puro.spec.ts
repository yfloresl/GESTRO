import { createHmac } from 'node:crypto';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { prorrateoCambioPlan, renovar } from '../src/suscripcion/periodos';
import {
  aCentavos, aceptaTransicion, celdaNumero, celdaTexto, claveDePago, deCentavos, desglosar, estadoLocalDe, ivaPorDentro, montoMeses, sumar, usdABobCent, validarDatosFiscales, verificarFirmaWebhook,
} from '../src/facturacion-kyros/nucleo';

// Recálculo INDEPENDIENTE con decimal.js (otra implementación, mitad hacia arriba), no con el código bajo prueba.
const ivaOraculo = (total: string) => new Decimal(total).mul('0.13').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const bsOraculo = (usd: string, tco: string) => new Decimal(usd).mul(tco).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

describe('IVA 13 % por dentro en centavos (Ley 843 art. 5)', () => {
  it('el ejemplo del informe: US$10 x 11,67 = Bs 116,70 y IVA 15,17', () => {
    const total = usdABobCent('10', '11.67');
    expect(deCentavos(total)).toBe('116.70');
    expect(deCentavos(ivaPorDentro(total))).toBe('15.17'); // 15,171 -> 15,17
  });
  it('nunca con 6,96: el mismo precio a 6,96 da otro monto y la factura usa el TCO inyectado', () => {
    expect(deCentavos(usdABobCent('10', '6.96'))).toBe('69.60');
    expect(deCentavos(usdABobCent('10', '11.67'))).not.toBe('69.60');
  });
  const casos = ['0.00', '0.01', '0.03', '0.04', '0.05', '0.38', '0.39', '1.00', '7.69', '116.70', '233.40', '408.45', '700.20', '1000.00', '4999.99', '99999999.99'];
  it.each(casos)('importe %s coincide con el oráculo decimal.js', (t) => expect(deCentavos(ivaPorDentro(aCentavos(t)))).toBe(ivaOraculo(t)));
  it('1 000 importes pseudoaleatorios coinciden centavo a centavo', () => {
    let s = 12345n;
    for (let i = 0; i < 1000; i++) { s = (s * 6364136223846793005n + 1442695040888963407n) % (1n << 63n); const c = (s % 5_000_000n) + 1n; expect(deCentavos(ivaPorDentro(c))).toBe(ivaOraculo(deCentavos(c))); }
  });
  it('TCO con decimales y redondeo mitad hacia arriba', () => {
    for (const [u, t] of [['20', '11.67'], ['35', '11.67'], ['60', '11.67'], ['0.01', '11.67'], ['19.99', '11.675'], ['15', '11.675'], ['99.99', '9.5']]) expect(deCentavos(usdABobCent(u!, t!))).toBe(bsOraculo(u!, t!));
    expect(['20', '35', '60'].map((u) => deCentavos(usdABobCent(u, '11.67')))).toEqual(['233.40', '408.45', '700.20']);
  });
  it('rechaza basura en vez de redondear en silencio', () => {
    for (const m of ['', 'abc', '1.234', '-5', '1e3', 'NaN']) expect(() => aCentavos(m)).toThrow();
    expect(() => aCentavos(Number.NaN)).toThrow();
    expect(aCentavos('116,70')).toBe(11670n);
    expect(() => ivaPorDentro(-1n)).toThrow();
  });
  it('desglose y suma exacta', () => {
    expect(desglosar(11670n)).toMatchObject({ total: '116.70', iva: '15.17' });
    expect(sumar(['0.10', '0.20', '116.70'])).toBe('117.00'); // con flotantes 0,1 + 0,2 daría 0,30000000000000004
  });
});

describe('monto de los meses con promoción y se factura lo cobrado', () => {
  it('3 meses a Bs 233,40 con 10 % = 630,18; 2 meses sin descuento = 466,80', () => {
    expect(deCentavos(montoMeses(23340n, 3, '10'))).toBe(new Decimal('233.40').mul(3).mul('0.9').toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
    expect(deCentavos(montoMeses(23340n, 3, '10'))).toBe('630.18');
    expect(deCentavos(montoMeses(23340n, 2))).toBe('466.80');
  });
  it('descuentos y meses inválidos', () => { expect(() => montoMeses(100n, 0)).toThrow(); expect(() => montoMeses(100n, 1, '100.01')).toThrow(); expect(deCentavos(montoMeses(100n, 1, '100'))).toBe('0.00'); });
  it('cambio de plan con prorrateo: la factura es sobre el dinero COBRADO, no sobre los días ni el crédito', () => {
    // Plan 20 -> 35 USD a TCO 11,67: viejo 233,40; nuevo 408,45; quedan 20 días pagados.
    const pr = prorrateoCambioPlan({ diasRestantes: 20, precioViejoCent: 23340n, precioNuevoCent: 40845n });
    expect(pr.diasNuevos).toBe(11); // floor(20 x 233,40 / 408,45)
    // No hay cobro en el cambio: no se emite factura por el crédito. Si después paga 1 mes de 408,45, la factura es de 408,45 y 53,10 de IVA.
    expect(deCentavos(desglosar(40845n).ivaCent)).toBe(ivaOraculo('408.45'));
    expect(ivaOraculo('408.45')).toBe('53.10');
  });
  it('renovar antes de vencer suma días: la suma de facturas = suma de lo cobrado', () => {
    const r = renovar({ hoy: '2026-12-10', hasta: '2026-12-30', ancla: null, meses: 1 });
    expect(r.hasta).toBe('2027-01-30');
    const pagos = ['116.70', '116.70', '233.40'];
    expect(sumar(pagos.map((p) => deCentavos(desglosar(aCentavos(p)).totalCent)))).toBe('466.80');
    expect(sumar(pagos.map((p) => deCentavos(desglosar(aCentavos(p)).ivaCent)))).toBe(new Decimal(0).add(ivaOraculo('116.70')).add(ivaOraculo('116.70')).add(ivaOraculo('233.40')).toFixed(2));
  });
});

describe('datos fiscales', () => {
  it('NIT válido e inválido', () => {
    expect(validarDatosFiscales({ numero: '1020304050', razonSocial: ' Casa  Andina SRL ' })).toMatchObject({ ok: true, datos: { tipo: 'NIT', numero: '1020304050', razonSocial: 'Casa Andina SRL' } });
    for (const n of ['0123456', '123', '12345678901234', 'ABC12345', '12 3456-7'.replace(/\d/g, 'x')]) expect(validarDatosFiscales({ numero: n, razonSocial: 'X SRL' }).ok).toBe(false);
    expect(validarDatosFiscales({ numero: '123.456-78', razonSocial: 'X SRL' }).ok).toBe(true);
  });
  it('CI con complemento, razón social vacía o con control, correo', () => {
    expect(validarDatosFiscales({ tipo: 'CI', numero: '4567890', complemento: '1a', razonSocial: 'Juan Pérez' })).toMatchObject({ ok: true, datos: { complemento: '1A' } });
    expect(validarDatosFiscales({ tipo: 'NIT', numero: '1020304050', complemento: '1', razonSocial: 'X SRL' }).ok).toBe(false);
    expect(validarDatosFiscales({ numero: '1020304050', razonSocial: '' }).ok).toBe(false);
    expect(validarDatosFiscales({ numero: '1020304050', razonSocial: 'A\u0000B' }).ok).toBe(false);
    expect(validarDatosFiscales({ numero: '1020304050', razonSocial: 'X SRL', correo: 'no-es-correo' }).ok).toBe(false);
  });
});

describe('CSV sin inyección de fórmulas', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])('neutraliza %j', (v) => expect(celdaTexto(v).startsWith('"\'')).toBe(true));
  it('escapa comillas y saltos de línea', () => { expect(celdaTexto('di "hola"\nmundo')).toBe('"di ""hola"" mundo"'); expect(celdaTexto(null)).toBe('""'); });
  it('los importes solo aceptan números', () => { expect(celdaNumero('-12.50')).toBe('-12.50'); expect(() => celdaNumero('=1+1')).toThrow(); expect(celdaNumero(null)).toBe(''); });
});

describe('estados y claves', () => {
  it('mapeo de FacturaSIN y transiciones sin retroceso', () => {
    expect(['validada', 'pendiente', 'contingencia', 'observada', 'rechazada', 'anulada'].map(estadoLocalDe)).toEqual(['emitida', 'en_proceso', 'en_proceso', 'observada', 'rechazada', 'anulada']);
    expect(aceptaTransicion('en_proceso', 'emitida')).toBe(true);
    expect(aceptaTransicion('emitida', 'en_proceso')).toBe(false);
    expect(aceptaTransicion('emitida', 'anulada')).toBe(true);
    expect(aceptaTransicion('anulada', 'emitida')).toBe(false);
    expect(aceptaTransicion('pendiente', 'anulada')).toBe(false);
  });
  it('idempotencia = id de pago; solo cambia tras un rechazo', () => { expect(claveDePago('gestro', 'abc', 1)).toBe('gestro:suscripcion-abc'); expect(claveDePago('gestro', 'abc', 3)).toBe('gestro:suscripcion-abc:r3'); });
});

describe('firma del webhook (vector de FacturaSIN)', () => {
  const secreto = '0123456789abcdef'.repeat(4); const cuerpo = '{"id":"e1","tipo":"factura.validada"}'; const t = 1700000000;
  const firma = (s: string, ts: number, c: string) => `t=${ts},v1=${createHmac('sha256', s).update(`${ts}.${c}`).digest('hex')}`;
  it('vector publicado', () => expect(firma(secreto, t, cuerpo)).toBe('t=1700000000,v1=0a8a658d5bfb9f9af5215b4f905eedaab86bf258f69533057f991aa18c783796'));
  it('acepta lo válido, rota secretos, rechaza cuerpo alterado, secreto ajeno y firmas de más de 5 minutos', () => {
    const ahora = t * 1000;
    expect(verificarFirmaWebhook([secreto], firma(secreto, t, cuerpo), cuerpo, ahora)).toBe(true);
    expect(verificarFirmaWebhook(['f'.repeat(64), secreto], firma(secreto, t, cuerpo), cuerpo, ahora)).toBe(true);
    expect(verificarFirmaWebhook([secreto], firma(secreto, t, cuerpo), cuerpo + ' ', ahora)).toBe(false);
    expect(verificarFirmaWebhook(['f'.repeat(64)], firma(secreto, t, cuerpo), cuerpo, ahora)).toBe(false);
    expect(verificarFirmaWebhook([secreto], firma(secreto, t, cuerpo), cuerpo, ahora + 301_000)).toBe(false);
    expect(verificarFirmaWebhook([secreto], 'basura', cuerpo, ahora)).toBe(false);
  });
});
