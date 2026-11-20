import Decimal from 'decimal.js';

/**
 * Piezas PURAS del turno de caja (sin base de datos) para poder probarlas con aritmética exacta.
 */

export interface FilaCobro { metodo: string; total: string; cantidad: number }

/**
 * GST-C06: «Cobros del turno». Además de los cobros de ventas por método y de los cobros de cuentas en efectivo (que SÍ suman al cajón), se
 * lista el cobro de cuentas hecho por banco: se muestra como renglón aparte y NO entra al efectivo esperado (no pasó por el cajón).
 */
export function cobrosDelTurno(porMetodo: FilaCobro[], cuentasEfectivo: { total: string; n: number }, cuentasBanco: { total: string; n: number }): FilaCobro[] {
  const filas = [...porMetodo];
  if (cuentasEfectivo.n > 0) filas.push({ metodo: 'cuentas_por_cobrar', total: cuentasEfectivo.total, cantidad: cuentasEfectivo.n });
  if (cuentasBanco.n > 0) filas.push({ metodo: 'cuentas_por_cobrar_banco', total: cuentasBanco.total, cantidad: cuentasBanco.n });
  return filas;
}

/** GST-C03: contado menos esperado, en centavos exactos (positivo = sobrante, negativo = faltante). */
export function diferenciaDeCaja(contado: Decimal.Value, esperado: Decimal.Value): string {
  return new Decimal(contado).minus(esperado).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** GST-C03: la explicación del cajero solo se guarda cuando hay diferencia; sin diferencia no queda nada (y se ignora lo que llegue). */
export function notaDeDiferencia(diferencia: string, explicacion?: string | null): string | null {
  if (new Decimal(diferencia).isZero()) return null;
  const e = (explicacion ?? '').trim();
  return e.length > 0 ? e.slice(0, 300) : null;
}
