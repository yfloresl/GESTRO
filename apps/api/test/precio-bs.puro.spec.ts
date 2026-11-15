import { describe, expect, it } from 'vitest';
import { precioMensualBs, tasaMicros, usdABobCentavos } from '../src/suscripcion/precio-bs';

// Recálculo independiente: BigInt sobre cadenas decimales, sin flotantes. El TC es un DATO inyectado, nunca una constante del código.
const exacto = (usd: string, tc: string): string => {
  const [ue, uf = ''] = usd.split('.'); const [te, tf = ''] = tc.split('.');
  const u = BigInt(ue + (uf + '00').slice(0, 2)); const t = BigInt(te + (tf + '000000').slice(0, 6));
  const c = (u * t + 500_000n) / 1_000_000n;
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
};

describe('precio en Bs = USD x TCO del día (exacto)', () => {
  const casos: Array<[string, number]> = [['20', 11.67], ['35', 11.67], ['60', 11.67], ['0.01', 11.67], ['19.99', 11.675], ['15', 11.675], ['20', 12.09], ['99.99', 9.5], ['0', 11.67]];
  it.each(casos)('USD %s a %f', (usd, tc) => {
    const r = precioMensualBs({ bob: '1.00', usd }, { usdBob: tc, fecha: '2026-11-14', fuente: 'dato de prueba' });
    expect(r.precio).toBe(exacto(usd, String(tc)));
    expect(r.fx?.usdBob).toBe(tc);
  });
  it('20 USD a 11,67 = Bs 233,40; 35 = 408,45; 60 = 700,20 (cuentas a mano)', () => {
    const tco = { usdBob: 11.67, fecha: '2026-11-14', fuente: 'dato de prueba' };
    expect(['20', '35', '60'].map((u) => precioMensualBs({ bob: null, usd: u }, tco).precio)).toEqual(['233.40', '408.45', '700.20']);
  });
  it('mitad hacia arriba al centavo (15 x 11,675 = 175,125 -> 175,13)', () => expect(usdABobCentavos('15', 11.675)).toBe(17513n));
  it('sin precio en USD conserva el precio en Bs y no necesita TCO', () => expect(precioMensualBs({ bob: '299.00', usd: null }, null)).toEqual({ precio: '299.00', fx: null }));
  it('con precio en USD y sin TCO falla (nunca inventa)', () => expect(() => precioMensualBs({ bob: '174.00', usd: '20' }, null)).toThrow());
  it('tasa inválida', () => { for (const t of [0, -1, NaN]) expect(() => tasaMicros(t)).toThrow(); });
});
