/**
 * Precio mensual en bolivianos de un plan, con aritmética entera (BigInt) y el tipo de cambio OFICIAL del día de la operación.
 * Desde el 29/06/2026 el Bs 6,96 fijo ya no existe: el BCB publica el TCO a diario. Un plan con precio en USD se cobra en
 * Bs = USD x TCO (redondeo al centavo, mitad hacia arriba); un plan sin precio en USD conserva su precio en Bs cargado a mano.
 */
export const aCentavos = (x: string): bigint => {
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(x.trim());
  if (!m) throw new RangeError(`Monto inválido: ${x}`);
  return BigInt(m[1]) * 100n + BigInt(((m[2] ?? '') + '00').slice(0, 2));
};

export const centavosATexto = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;

/** Tasa decimal (hasta 6 decimales) como entero en millonésimas. */
export function tasaMicros(tc: number): bigint {
  if (!Number.isFinite(tc) || tc <= 0) throw new RangeError('Tipo de cambio inválido');
  const [e, f = ''] = tc.toFixed(6).split('.');
  return BigInt(e) * 1_000_000n + BigInt(f);
}

/** USD (texto con hasta 2 decimales) x TCO -> centavos de Bs, mitad hacia arriba. */
export function usdABobCentavos(usd: string, usdBob: number): bigint {
  return (aCentavos(usd) * tasaMicros(usdBob) + 500_000n) / 1_000_000n;
}

export interface PrecioPlan { bob: string | null; usd: string | null }
export interface TcoUsado { usdBob: number; fecha: string; fuente: string }

/** Precio mensual en Bs (texto con 2 decimales) o null si el plan no tiene precio. Con precio en USD exige el TCO. */
export function precioMensualBs(plan: PrecioPlan, tco: TcoUsado | null): { precio: string | null; fx: TcoUsado | null } {
  if (plan.usd === null || plan.usd === undefined) return { precio: plan.bob, fx: null };
  if (!tco) throw new RangeError('Falta el TCO');
  return { precio: centavosATexto(usdABobCentavos(plan.usd, tco.usdBob)), fx: tco };
}
