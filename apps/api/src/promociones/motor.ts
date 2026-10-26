import Decimal from 'decimal.js';

/**
 * Motor de promociones: funciones PURAS (sin base de datos). Dado el precio de lista de un plato, el momento (hora local de la
 * sucursal) y las promociones activas, devuelve el mejor precio para el cliente. Dinero con decimal.js y a 2 decimales.
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export interface Promo {
  id: string; nombre: string;
  descuentoPct: string | null; precioFijo: string | null;
  /** Días ISO (1 = lunes … 7 = domingo). null = todos. */
  dias: number[] | null;
  /** Horario «HH:MM». Si horaDesde > horaHasta cruza la medianoche. null = todo el día. */
  horaDesde: string | null; horaHasta: string | null;
  /** Platos a los que aplica. Vacío = todos. */
  platos: string[];
}
export interface Momento { diaIso: number; hora: string }

const diaAnterior = (d: number) => (d === 1 ? 7 : d - 1);

/** ¿La promoción rige en este momento (día y hora)? La vigencia por fechas la filtra la consulta. */
export function enHorario(p: Pick<Promo, 'dias' | 'horaDesde' | 'horaHasta'>, m: Momento): boolean {
  const { horaDesde: d, horaHasta: h } = p;
  if (!d || !h) return !p.dias || p.dias.includes(m.diaIso);
  if (d < h) return (!p.dias || p.dias.includes(m.diaIso)) && m.hora >= d && m.hora < h;
  if (d === h) return !p.dias || p.dias.includes(m.diaIso);                       // 24 horas
  // Cruza la medianoche: la parte de después de las 00:00 pertenece al día que empezó la promoción.
  if (m.hora >= d) return !p.dias || p.dias.includes(m.diaIso);
  if (m.hora < h) return !p.dias || p.dias.includes(diaAnterior(m.diaIso));
  return false;
}

export function aplicaAlPlato(p: Pick<Promo, 'platos'>, platoId: string): boolean { return p.platos.length === 0 || p.platos.includes(platoId); }

/** Precio con una promoción: porcentaje de descuento sobre la lista, o precio fijo (nunca sube el precio). */
export function precioConPromo(lista: Decimal.Value, p: Pick<Promo, 'descuentoPct' | 'precioFijo'>): Decimal {
  const base = new Decimal(lista).toDecimalPlaces(2);
  const nuevo = p.precioFijo !== null ? new Decimal(p.precioFijo) : base.mul(new Decimal(100).minus(p.descuentoPct ?? 0)).div(100);
  const r = nuevo.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return Decimal.min(Decimal.max(r, 0), base);
}

export interface Resultado { precio: string; lista: string; promoId: string | null; promo: string | null }

/** La mejor promoción para el cliente: el precio más bajo; si empatan, la más antigua en la lista (la primera). */
export function mejorPrecio(lista: Decimal.Value, platoId: string, promos: Promo[], m: Momento): Resultado {
  const base = new Decimal(lista).toDecimalPlaces(2);
  let mejor: { p: Promo; precio: Decimal } | null = null;
  for (const p of promos) {
    if (!aplicaAlPlato(p, platoId) || !enHorario(p, m)) continue;
    const precio = precioConPromo(base, p);
    if (precio.lt(base) && (!mejor || precio.lt(mejor.precio))) mejor = { p, precio };
  }
  return mejor ? { precio: mejor.precio.toFixed(2), lista: base.toFixed(2), promoId: mejor.p.id, promo: mejor.p.nombre } : { precio: base.toFixed(2), lista: base.toFixed(2), promoId: null, promo: null };
}
