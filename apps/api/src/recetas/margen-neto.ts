import Decimal from 'decimal.js';

export type CriterioIva = 'incluido' | 'porcentaje';
export interface MargenNeto { iva: string; it: string; ganancia: string; margenPct: string | null }

const r2 = (n: Decimal) => n.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * gestro-032: margen de un plato DESPUÉS de impuestos (informativo, supone venta con factura).
 *  - IVA «incluido»: el precio ya trae el IVA → IVA = precio × iva / (100 + iva)  (13/113, igual que los asientos).
 *  - IVA «porcentaje»: IVA = precio × iva / 100.
 *  - IT = precio × it / 100 (base: el precio cobrado, igual que el cálculo de IT de Contabilidad).
 *  ganancia = precio − costo − IVA − IT; margen = ganancia / precio. El crédito fiscal de las compras no se descuenta (referencial).
 * El criterio 13/113 vs 13 % lo decide el dueño/contador: por eso es un parámetro de la sucursal.
 */
export function margenNeto(precio: Decimal.Value, costo: Decimal.Value, ivaPct: Decimal.Value, itPct: Decimal.Value, criterio: CriterioIva = 'incluido'): MargenNeto | null {
  const p = new Decimal(precio);
  if (!p.gt(0)) return null;
  const iva = criterio === 'incluido' ? p.mul(ivaPct).div(new Decimal(100).plus(ivaPct)) : p.mul(ivaPct).div(100);
  const it = p.mul(itPct).div(100);
  const gan = p.minus(costo).minus(iva).minus(it);
  return { iva: r2(iva).toFixed(2), it: r2(it).toFixed(2), ganancia: r2(gan).toFixed(2), margenPct: r2(gan.div(p).mul(100)).toFixed(2) };
}
