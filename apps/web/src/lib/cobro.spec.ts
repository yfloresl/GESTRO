import { describe, expect, it } from 'vitest';
import { aCentavos, calcularCobro, deCentavos, leerPorcentaje, pctTxt, topeEnCentavos } from './cobro';

const base = { subtotal: 21800, descuento: '', motivo: '', propina: '', metodo: 'efectivo', recibido: '' };
describe('cobro en centavos (GST-004)', () => {
  it('convierte montos sin flotantes', () => {
    expect(['12', '12,5', '12.50', '0,01', '', '0.1'].map(aCentavos)).toEqual([1200, 1250, 1250, 1, 0, 10]);
    expect(['12,345', 'abc', '-5', '1e3'].map(aCentavos)).toEqual([null, null, null, null]);
    expect(deCentavos(5)).toBe('0.05'); expect(deCentavos(21800)).toBe('218.00');
  });
  it('vuelto exacto: 218,00 recibe 250 → 32,00; con propina 10 recibe 250 → 22,00', () => {
    expect(calcularCobro({ ...base, recibido: '250' })).toMatchObject({ aCobrar: 21800, vuelto: 3200, error: null });
    expect(calcularCobro({ ...base, propina: '10', recibido: '250' })).toMatchObject({ aCobrar: 22800, vuelto: 2200, error: null });
  });
  it('centavos sueltos sin error de flotante', () => {
    expect(calcularCobro({ ...base, subtotal: 10, propina: '0,03', recibido: '0,13' })).toMatchObject({ aCobrar: 13, vuelto: 0, error: null });
  });
  it('efectivo insuficiente indica cuánto falta', () => {
    expect(calcularCobro({ ...base, recibido: '200' }).error).toBe('Faltan Bs 18.00 para cubrir el cobro.');
  });
  it('descuento: exige motivo y respeta el tope del 30 %', () => {
    expect(calcularCobro({ ...base, descuento: '10' }).error).toMatch(/motivo/);
    expect(calcularCobro({ ...base, descuento: '65,40', motivo: 'Cortesía' })).toMatchObject({ descuento: 6540, total: 15260, error: null });
    expect(calcularCobro({ ...base, descuento: '65,41', motivo: 'Cortesía' }).error).toMatch(/30 %/);
    expect(calcularCobro({ ...base, descuento: '65,41', motivo: 'Cortesía' }).descuentoExcedidoTope).toBe(6540);   // gestro-026
    expect(calcularCobro({ ...base, descuento: '65,40', motivo: 'Cortesía' }).descuentoExcedidoTope).toBeUndefined();
  });
  it('propina: tope del 30 % del total y sin crédito', () => {
    expect(calcularCobro({ ...base, propina: '65,40' }).error).toBeNull();
    expect(calcularCobro({ ...base, propina: '65,41' }).error).toMatch(/30 %/);
    expect(calcularCobro({ ...base, metodo: 'credito', propina: '5' }).error).toMatch(/crédito/);
  });
  it('GST-010: topes configurables, 20000 casos contra BigInt', () => {
    let seed = 4242; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pcts = [0, 0.01, 5, 12.5, 29.99, 30, 33.33, 99.99, 100];
    for (let i = 0; i < 20000; i++) {
      const dp = pcts[rnd(pcts.length)]; const pp = pcts[rnd(pcts.length)]; const sub = 1 + rnd(5_000_000);
      const tD = Number((BigInt(sub) * BigInt(Math.round(dp * 100))) / 10000n);
      expect(topeEnCentavos(sub, dp)).toBe(tD);
      const d = rnd(tD + 1); const total = sub - d; if (total <= 0) continue;
      const tP = Number((BigInt(total) * BigInt(Math.round(pp * 100))) / 10000n); const p = rnd(tP + 1);
      const r = calcularCobro({ subtotal: sub, descuento: deCentavos(d), motivo: 'motivo', propina: deCentavos(p), metodo: 'tarjeta', recibido: '', topes: { descuentoPct: dp, propinaPct: pp } });
      expect(r).toMatchObject({ total, aCobrar: total + p, error: null });
      if (tD + 1 <= sub) expect(calcularCobro({ subtotal: sub, descuento: deCentavos(tD + 1), motivo: 'motivo', propina: '', metodo: 'tarjeta', recibido: '', topes: { descuentoPct: dp, propinaPct: pp } }).error).toMatch(/descuento/i);
    }
  });
  it('GST-010: mensajes con el tope configurado y lector de porcentajes', () => {
    const t = { descuentoPct: 12.5, propinaPct: 0 };
    expect(calcularCobro({ ...base, descuento: '27,26', motivo: 'Cortesía', topes: t }).error).toMatch(/12,5 %/);
    expect(calcularCobro({ ...base, descuento: '27,25', motivo: 'Cortesía', topes: t }).error).toBeNull();
    expect(calcularCobro({ ...base, propina: '0,01', topes: t }).error).toMatch(/0 %/);
    expect(['30', '12,5', '12.50', '0', '100', '100,00', ' 7 '].map(leerPorcentaje)).toEqual([30, 12.5, 12.5, 0, 100, 100, 7]);
    expect(['100,01', '101', '-1', '12,345', 'abc', '', '1e2'].map(leerPorcentaje)).toEqual([null, null, null, null, null, null, null]);
    expect(pctTxt(30)).toBe('30'); expect(pctTxt(12.5)).toBe('12,5');
  });
});
