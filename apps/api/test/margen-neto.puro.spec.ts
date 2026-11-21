import { describe, expect, it } from 'vitest';
import { margenNeto } from '../src/recetas/margen-neto';

// Verificación independiente (a mano): precio 100, costo 30, IVA 13, IT 3.
//  incluido:   IVA = 100×13/113 = 11,5044 → 11,50; IT = 3,00; ganancia = 100 − 30 − 11,5044 − 3 = 55,4956 → 55,50 ; margen 55,50 %
//  porcentaje: IVA = 13,00; IT = 3,00; ganancia = 54,00 ; margen 54,00 %
describe('margenNeto (gestro-032)', () => {
  it('IVA incluido (13/113)', () => { expect(margenNeto('100', '30', 13, 3, 'incluido')).toEqual({ iva: '11.50', it: '3.00', ganancia: '55.50', margenPct: '55.50' }); });
  it('IVA como 13 % del precio', () => { expect(margenNeto('100', '30', 13, 3, 'porcentaje')).toEqual({ iva: '13.00', it: '3.00', ganancia: '54.00', margenPct: '54.00' }); });
  it('el neto siempre es menor que el bruto', () => { expect(Number(margenNeto('45', '12.5', 13, 3)!.margenPct)).toBeLessThan((45 - 12.5) / 45 * 100); });
  it('plato de Bs 45 con costo 12,50: 45 − 12,50 − 5,18 − 1,35 = 25,97 (57,72 %: 25,97301 / 45)', () => { expect(margenNeto('45', '12.5', 13, 3)).toEqual({ iva: '5.18', it: '1.35', ganancia: '25.97', margenPct: '57.72' }); });
  it('sin precio no hay margen; tasas en cero devuelven el bruto', () => {
    expect(margenNeto('0', '5', 13, 3)).toBeNull();
    expect(margenNeto('100', '30', 0, 0)!.margenPct).toBe('70.00');
  });
});
