import Decimal from 'decimal.js';

/** Topes de negocio del cobro (GST-004). Se revisan en el servidor; la pantalla solo los repite. */
export const DESCUENTO_MAX_PCT = 30;
export const PROPINA_MAX_PCT = 30;

export class CobroInvalido extends Error {}

/**
 * Cálculo del cobro en centavos exactos (decimal.js, nunca flotantes):
 * total = subtotal − descuento; a cobrar = total + propina; vuelto = recibido − a cobrar.
 * El descuento tiene tope (% del subtotal) y exige motivo; la propina tiene tope (% del total) y no aplica a crédito;
 * el efectivo recibido solo aplica al método efectivo y debe cubrir todo lo que se cobra.
 */
export function calcularCobro(p: { subtotal: Decimal.Value; descuento: Decimal.Value; motivoDescuento?: string; propina: Decimal.Value; metodo: string; efectivoRecibido?: Decimal.Value | null }) {
  const r2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const subtotal = r2(p.subtotal); const descuento = r2(p.descuento); const propina = r2(p.propina);
  if (descuento.lt(0) || propina.lt(0)) throw new CobroInvalido('El descuento y la propina no pueden ser negativos.');
  if (descuento.gt(0) && (p.motivoDescuento ?? '').trim().length < 3) throw new CobroInvalido('Un descuento necesita su motivo (mínimo 3 letras).');
  const tope = subtotal.mul(DESCUENTO_MAX_PCT).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  if (descuento.gt(tope)) throw new CobroInvalido(`El descuento no puede pasar del ${DESCUENTO_MAX_PCT} % del pedido (Bs ${tope.toFixed(2)}).`);
  const total = subtotal.minus(descuento);
  if (total.lte(0)) throw new CobroInvalido('El descuento no puede dejar el pedido en cero.');
  const topeProp = total.mul(PROPINA_MAX_PCT).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  if (propina.gt(topeProp)) throw new CobroInvalido(`La propina no puede pasar del ${PROPINA_MAX_PCT} % del total (Bs ${topeProp.toFixed(2)}).`);
  if (propina.gt(0) && p.metodo === 'credito') throw new CobroInvalido('Una venta a crédito no lleva propina.');
  const aCobrar = total.plus(propina);
  let recibido: Decimal | null = null; let vuelto: Decimal | null = null;
  if (p.efectivoRecibido !== undefined && p.efectivoRecibido !== null) {
    if (p.metodo !== 'efectivo') throw new CobroInvalido('El efectivo recibido solo aplica al cobro en efectivo.');
    recibido = r2(p.efectivoRecibido);
    if (recibido.lt(aCobrar)) throw new CobroInvalido(`El efectivo recibido (Bs ${recibido.toFixed(2)}) no alcanza: faltan Bs ${aCobrar.minus(recibido).toFixed(2)}.`);
    vuelto = recibido.minus(aCobrar);
  }
  return { subtotal: subtotal.toFixed(2), descuento: descuento.toFixed(2), total: total.toFixed(2), propina: propina.toFixed(2), aCobrar: aCobrar.toFixed(2), recibido: recibido?.toFixed(2) ?? null, vuelto: vuelto?.toFixed(2) ?? null };
}
