import { describe, expect, it } from 'vitest';
import { calcularCobro, CobroInvalido } from '../src/pedidos/cobro-calculo';
import { ventaCobrada } from '../src/contabilidad/asientos';

// Recálculo independiente con enteros (centavos): el servidor usa decimal.js.
const c = (x: number) => `${Math.floor(x / 100)}.${String(x % 100).padStart(2, '0')}`;
describe('cobro: descuento, propina y vuelto (GST-004)', () => {
  it('218,00 con descuento 20,00, propina 5,00 y 250 recibidos', () => {
    expect(calcularCobro({ subtotal: '218.00', descuento: '20.00', motivoDescuento: 'Cumpleaños', propina: '5.00', metodo: 'efectivo', efectivoRecibido: '250' }))
      .toEqual({ subtotal: '218.00', descuento: '20.00', total: '198.00', propina: '5.00', aCobrar: '203.00', recibido: '250.00', vuelto: '47.00' });
  });
  it('5000 casos contra aritmética entera', () => {
    let seed = 12345; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 5000; i++) {
      const sub = 1 + rnd(2_000_000); const d = rnd(Math.floor((sub * 30) / 100) + 1);
      const total = sub - d; if (total <= 0) continue; const p = rnd(Math.floor((total * 30) / 100) + 1);
      const rec = total + p + rnd(100000);
      const r = calcularCobro({ subtotal: c(sub), descuento: c(d), motivoDescuento: 'motivo', propina: c(p), metodo: 'efectivo', efectivoRecibido: c(rec) });
      expect(r).toMatchObject({ total: c(total), aCobrar: c(total + p), vuelto: c(rec - total - p) });
    }
  });
  it('rechaza: sin motivo, sobre el tope, efectivo corto, recibido con tarjeta, propina a crédito', () => {
    const b = { subtotal: '100', descuento: '0', propina: '0', metodo: 'efectivo' };
    expect(() => calcularCobro({ ...b, descuento: '10' })).toThrow(CobroInvalido);
    expect(() => calcularCobro({ ...b, descuento: '30.01', motivoDescuento: 'x yz' })).toThrow(/30 %/);
    expect(calcularCobro({ ...b, descuento: '30.00', motivoDescuento: 'x yz' }).total).toBe('70.00');
    expect(() => calcularCobro({ ...b, efectivoRecibido: '99.99' })).toThrow(/faltan Bs 0.01/);
    expect(() => calcularCobro({ ...b, metodo: 'tarjeta', efectivoRecibido: '100' })).toThrow(/solo aplica/);
    expect(() => calcularCobro({ ...b, metodo: 'credito', propina: '1' })).toThrow(/crédito/);
  });
  it('el asiento con propina cuadra; la propina no es venta ni lleva IVA', () => {
    const a = ventaCobrada({ total: '113.00', metodo: 'efectivo', documento: 'factura', ivaPct: 13, propina: '10.00' });
    expect(a.lineas).toEqual([
      { cuenta: 'caja', debe: '123.00', haber: '0.00' }, { cuenta: 'ventas', debe: '0.00', haber: '100.00' },
      { cuenta: 'debito_fiscal', debe: '0.00', haber: '13.00' }, { cuenta: 'propinas', debe: '0.00', haber: '10.00' },
    ]);
  });

  it('GST-010: topes configurables — 6000 casos contra BigInt (centésimas de %), incluidos 0 %, 100 % y decimales', () => {
    let seed = 987654; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pcts = [0, 0.01, 5, 10, 12.5, 29.99, 30, 33.33, 50, 99.99, 100];
    const txt = (x: bigint) => `${x / 100n}.${String(x % 100n).padStart(2, '0')}`;
    let n = 0;
    for (let i = 0; i < 6000; i++) {
      const dp = pcts[rnd(pcts.length)]; const pp = pcts[rnd(pcts.length)];
      const sub = BigInt(1 + rnd(5_000_000));
      const dbp = BigInt(Math.round(dp * 100)); const pbp = BigInt(Math.round(pp * 100));
      const topeD = (sub * dbp) / 10000n;                                   // floor, en centavos
      const d = BigInt(rnd(Number(topeD) + 1)); const total = sub - d;
      const topeP = (total * pbp) / 10000n;
      const p = BigInt(rnd(Number(topeP) + 1));
      const entrada = { subtotal: txt(sub), descuento: txt(d), motivoDescuento: 'motivo', propina: txt(p), metodo: 'efectivo', efectivoRecibido: txt(total + p), topes: { descuentoPct: dp, propinaPct: pp } };
      if (total <= 0n) { expect(() => calcularCobro(entrada)).toThrow(/cero/); continue; }
      expect(calcularCobro(entrada)).toMatchObject({ total: txt(total), aCobrar: txt(total + p), vuelto: '0.00' }); n++;
      // un centavo por encima del tope se rechaza
      expect(() => calcularCobro({ ...entrada, descuento: txt(topeD + 1n), efectivoRecibido: undefined })).toThrow(CobroInvalido);
      if (total - 0n > 0n) expect(() => calcularCobro({ ...entrada, propina: txt(topeP + 1n), efectivoRecibido: undefined })).toThrow(CobroInvalido);
    }
    expect(n).toBeGreaterThan(3000);
  });
  it('GST-010: tope 0 % bloquea; 100 % de descuento no deja el pedido en cero; el valor por defecto sigue siendo 30 %', () => {
    const b = { subtotal: '100', descuento: '0', propina: '0', metodo: 'efectivo' };
    expect(() => calcularCobro({ ...b, descuento: '0.01', motivoDescuento: 'abc', topes: { descuentoPct: 0, propinaPct: 30 } })).toThrow(/0 %/);
    expect(() => calcularCobro({ ...b, propina: '0.01', topes: { descuentoPct: 30, propinaPct: 0 } })).toThrow(/0 %/);
    expect(() => calcularCobro({ ...b, descuento: '100', motivoDescuento: 'abc', topes: { descuentoPct: 100, propinaPct: 30 } })).toThrow(/cero/);
    expect(calcularCobro({ ...b, descuento: '99.99', motivoDescuento: 'abc', topes: { descuentoPct: 100, propinaPct: 30 } }).total).toBe('0.01');
    expect(calcularCobro({ ...b, descuento: '12.50', motivoDescuento: 'abc', topes: { descuentoPct: 12.5, propinaPct: 30 } }).total).toBe('87.50');
    expect(() => calcularCobro({ ...b, descuento: '12.51', motivoDescuento: 'abc', topes: { descuentoPct: 12.5, propinaPct: 30 } })).toThrow(/12,5 %/);
    expect(() => calcularCobro({ ...b, descuento: '30.01', motivoDescuento: 'abc' })).toThrow(/30 %/);
  });
});
