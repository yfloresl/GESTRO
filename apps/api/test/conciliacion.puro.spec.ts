import { describe, expect, it } from 'vitest';
import { conciliarVentas, rellenarHuecos } from '../src/estadisticas/conciliacion';

describe('conciliarVentas (gestro-024)', () => {
  it('773,00 a precio de lista − 57,20 de descuentos = 715,80 de ingresos: diferencia 0', () => {
    expect(conciliarVentas('773', '57.20', '715.80')).toEqual({ ventasAPrecioLista: '773.00', descuentos: '57.20', ingresos: '715.80', diferenciaSinExplicar: '0.00' });
  });
  it('si no cuadra, expone la diferencia en vez de ocultarla', () => {
    expect(conciliarVentas('773', '50.00', '715.80').diferenciaSinExplicar).toBe('7.20');
  });
  it('sin flotantes: 0,1 + 0,2', () => { expect(conciliarVentas('0.30', '0.10', '0.20').diferenciaSinExplicar).toBe('0.00'); });
});
describe('rellenarHuecos (gestro-023)', () => {
  const f = (clave: string) => ({ clave, etiqueta: `${clave}:00`, ventas: '10.00', cantidad: '1', participacionPct: '50.00' });
  it('hora: rellena con ceros entre la primera y la última', () => {
    const r = rellenarHuecos([f('1'), f('4')], 'hora');
    expect(r.map((x) => [x.etiqueta, x.ventas])).toEqual([['1:00', '10.00'], ['02:00', '0.00'], ['03:00', '0.00'], ['4:00', '10.00']]);
  });
  it('día: siempre los 7 días', () => { expect(rellenarHuecos([f('3')], 'dia_semana').map((x) => x.clave)).toEqual(['1', '2', '3', '4', '5', '6', '7']); });
});
