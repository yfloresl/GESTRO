import Decimal from 'decimal.js';

export interface FilaPropina { meseroId: string | null; mesero: string; dia: string; propina: string; entregada: string; pendiente: string; entregadaEl: string | null; entregadaPor: string | null }

/** Propina pendiente = propina del día − lo ya entregado (nunca negativa). Centavos exactos con decimal.js. */
export function pendienteDePropina(propina: Decimal.Value, entregada: Decimal.Value): string {
  const p = new Decimal(propina).minus(entregada);
  return (p.isNegative() ? new Decimal(0) : p).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Totales del reporte: propina, entregada y pendiente de todas las filas. */
export function totalesDePropinas(filas: Pick<FilaPropina, 'propina' | 'entregada' | 'pendiente'>[]) {
  const s = (k: 'propina' | 'entregada' | 'pendiente') => filas.reduce((t, f) => t.plus(f[k]), new Decimal(0)).toFixed(2);
  return { propina: s('propina'), entregada: s('entregada'), pendiente: s('pendiente') };
}
