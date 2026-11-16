import { describe, expect, it } from 'vitest';
import { AVISO_CODIGOS_NO_CONFIRMADOS, desglosarFiscal, evaluarRegimenFiscal, ivaPorDentroCent, ivaSobreNetoCent, netoParaTotalPorFuera } from '../src/facturacion-kyros/nucleo/normativa';

// Recálculo INDEPENDIENTE con aritmética entera distinta a la del módulo: neto = floor((total*100*2+113)/(2*113)).
const neto = (t: number) => Math.floor((t * 100 * 2 + 113) / (2 * 113));

describe('normativa: IVA por dentro y por fuera (enteros)', () => {
  it('Bs 116,70 por dentro: IVA 13 % del importe = 15,17; neto 101,53', () => {
    const d = desglosarFiscal(11670n);
    expect(d).toMatchObject({ modo: 'por_dentro', netoCent: 10153n, ivaCent: 1517n, totalCent: 11670n });
    expect(11670 * 13 / 100).toBeCloseTo(1517.1, 1); // 15,171 -> 15,17
  });
  it('Bs 116,70 por fuera, mismo precio final: neto 103,27 + IVA 13,43 = 116,70', () => {
    const d = desglosarFiscal(11670n, 'por_fuera');
    expect(d).toMatchObject({ modo: 'por_fuera', netoCent: 10327n, ivaCent: 1343n, totalCent: 11670n, exacto: true });
    expect(neto(11670)).toBe(10327);
    expect(ivaSobreNetoCent(10327n)).toBe(1343n);
  });
  it('anual Bs 1.167,00 por fuera: neto 1.032,74 + IVA 134,26', () => {
    const d = desglosarFiscal(116700n, 'por_fuera');
    expect(d.netoCent + d.ivaCent).toBe(116700n);
    expect(Number(d.netoCent)).toBe(neto(116700));
  });
  it('0 y 0,01: sin negativos y la suma siempre cuadra', () => {
    for (const m of ['por_dentro', 'por_fuera'] as const) {
      expect(desglosarFiscal(0n, m)).toMatchObject({ netoCent: 0n, ivaCent: 0n, totalCent: 0n });
      const d = desglosarFiscal(1n, m);
      expect(d.netoCent + d.ivaCent).toBe(1n);
    }
    expect(ivaPorDentroCent(1n)).toBe(0n);
  });
  it('barrido Bs 0,01 a 300,00: neto + IVA = total en ambos modos y la parte exacta se confirma', () => {
    for (let t = 1; t <= 30000; t++) {
      for (const m of ['por_dentro', 'por_fuera'] as const) {
        const d = desglosarFiscal(BigInt(t), m);
        expect(d.netoCent + d.ivaCent).toBe(BigInt(t));
        expect(d.netoCent >= 0n && d.ivaCent >= 0n).toBe(true);
      }
      const r = netoParaTotalPorFuera(BigInt(t));
      if (r.exacto) expect(r.netoCent + ivaSobreNetoCent(r.netoCent)).toBe(BigInt(t));
    }
  });
  it('importe negativo se rechaza', () => {
    expect(() => desglosarFiscal(-1n)).toThrow(RangeError);
  });
});

describe('F10: avisos de régimen (no bloquean)', () => {
  it('Régimen Simplificado avisa que no puede emitir factura con crédito fiscal', () => {
    const r = evaluarRegimenFiscal({ regimen: 'simplificado', nit: '1020304050' });
    expect(r.puedeFacturarConCredito).toBe(false);
    expect(r.avisos.join(' ')).toMatch(/Simplificado/);
    expect(r.avisos.join(' ')).toMatch(/D\.S\. 24484/);
  });
  it('Régimen General con NIT válido: sin avisos', () => {
    expect(evaluarRegimenFiscal({ regimen: 'general', nit: '1020304050', nitActivo: true })).toEqual({ avisos: [], puedeFacturarConCredito: true });
  });
  it('sin NIT, NIT con ceros a la izquierda o NIT inactivo: aviso de NIT activo', () => {
    for (const nit of [null, '', '0123456', '123']) expect(evaluarRegimenFiscal({ regimen: 'general', nit }).avisos.join(' ')).toMatch(/NIT/);
    expect(evaluarRegimenFiscal({ regimen: 'general', nit: '1020304050', nitActivo: false }).avisos.join(' ')).toMatch(/activo/);
  });
  it('el aviso estándar de códigos', () => {
    expect(AVISO_CODIGOS_NO_CONFIRMADOS).toBe('NO CONFIRMADO — definir con el catálogo del SIN');
  });
});

import { CODIGOS_PAGO_POR_DEFECTO, metodoPagoSin } from '../src/facturacion-emisor/calculo-factura';
describe('GESTRO Flujo 2: el método de pago es configuración', () => {
  it('efectivo 1 y tarjeta 2 fijos; «otro» sale de la configuración del restaurante', () => {
    expect(['efectivo', 'tarjeta', 'qr'].map((m) => metodoPagoSin(m))).toEqual([1, 2, 7]);
    expect(CODIGOS_PAGO_POR_DEFECTO).toEqual({ efectivo: 1, tarjeta: 2, otro: 7 });
    expect(metodoPagoSin('qr', { efectivo: 1, tarjeta: 2, otro: 5 })).toBe(5);
    expect(metodoPagoSin('transferencia', { efectivo: 1, tarjeta: 2, otro: 12 })).toBe(12);
  });
});
