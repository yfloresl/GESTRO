import { describe, expect, it } from 'vitest';
import { aCentavos, calcularCobro, deCentavos } from './cobro';

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
  });
  it('propina: tope del 30 % del total y sin crédito', () => {
    expect(calcularCobro({ ...base, propina: '65,40' }).error).toBeNull();
    expect(calcularCobro({ ...base, propina: '65,41' }).error).toMatch(/30 %/);
    expect(calcularCobro({ ...base, metodo: 'credito', propina: '5' }).error).toMatch(/crédito/);
  });
});
