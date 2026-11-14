import { describe, expect, it } from 'vitest';
import { hoyBolivia, hoyBoliviaMas } from '../src/comun/tiempo';

// Bolivia = UTC-4: la hora local 19:59 es 23:59 UTC; las 20:00 locales ya son las 00:00 UTC del día siguiente.
describe('hoy en Bolivia (America/La_Paz, UTC-4)', () => {
  it('19:59, 20:00, 23:59 y 00:00 locales', () => {
    expect(hoyBolivia(Date.UTC(2026, 10, 14, 23, 59))).toBe('2026-11-14'); // 19:59 local
    expect(hoyBolivia(Date.UTC(2026, 10, 15, 0, 0))).toBe('2026-11-14');   // 20:00 local: sigue siendo el 14 (en UTC ya sería el 15)
    expect(hoyBolivia(Date.UTC(2026, 10, 15, 3, 59))).toBe('2026-11-14');  // 23:59 local
    expect(hoyBolivia(Date.UTC(2026, 10, 15, 4, 0))).toBe('2026-11-15');   // 00:00 local
  });
  it('fin de mes, fin de año y bisiesto', () => {
    expect(hoyBolivia(Date.UTC(2026, 11, 31, 23, 30))).toBe('2026-12-31');
    expect(hoyBolivia(Date.UTC(2027, 0, 1, 3, 59))).toBe('2026-12-31');
    expect(hoyBolivia(Date.UTC(2028, 1, 29, 4, 0))).toBe('2028-02-29');
    expect(hoyBolivia(Date.UTC(2028, 2, 1, 3, 59))).toBe('2028-02-29');
    expect(hoyBoliviaMas(15, Date.UTC(2026, 10, 15, 0, 30))).toBe('2026-11-29'); // 20:30 local del 14/11 + 15 días
    expect(hoyBoliviaMas(1, Date.UTC(2028, 1, 29, 12, 0))).toBe('2028-03-01');
  });
});
