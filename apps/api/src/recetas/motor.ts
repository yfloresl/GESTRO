import Decimal from 'decimal.js';

/**
 * Motor de recetas: funciones PURAS (sin base de datos) para calcular insumos, faltantes y costo por porción.
 * Todo con decimal.js: nunca punto flotante. Una venta y un plan usan exactamente la misma fórmula.
 *
 *   consumo de una línea = cantidad × (porciones ÷ rendimiento) × (1 + merma% ÷ 100)
 *
 * Las sub-recetas (salsas, bases) producen un insumo: si una línea usa ese insumo, se expande de forma recursiva
 * hasta los insumos básicos. Un ciclo (A usa B y B usa A) es un error, no un bucle infinito.
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export interface Unidad { base: string; factor: string }
export interface LineaReceta { insumoId: string; cantidad: string; unidad: string }
export interface Receta { id: string; rendimiento: string; mermaPct: string; lineas: LineaReceta[] }
export interface Catalogo {
  unidades: Record<string, Unidad>;
  /** Unidad en la que se lleva el stock de cada insumo. */
  insumos: Record<string, { unidad: string; nombre?: string }>;
  /** Receta activa de cada plato. */
  recetaDePlato: Record<string, Receta | undefined>;
  /** Sub-receta activa que produce cada insumo (rinde `rendimiento` unidades del insumo). */
  subRecetaDeInsumo: Record<string, Receta | undefined>;
}

export class CicloDeRecetas extends Error { constructor(public readonly ruta: string[]) { super(`Ciclo de recetas: ${ruta.join(' → ')}`); } }
export class UnidadIncompatible extends Error {}
export class RecetaInvalida extends Error {}

/** Pasa una cantidad de una unidad a otra de la misma familia (g ↔ kg ↔ lb, ml ↔ l). */
export function convertir(cantidad: Decimal.Value, de: string, a: string, unidades: Record<string, Unidad>): Decimal {
  const u = unidades[de]; const v = unidades[a];
  if (!u || !v) throw new UnidadIncompatible(`Unidad desconocida: ${!u ? de : a}`);
  if (u.base !== v.base) throw new UnidadIncompatible(`No se puede convertir ${de} a ${a}`);
  return new Decimal(cantidad).mul(u.factor).div(v.factor);
}

const MAX_PROFUNDIDAD = 8;

/** Acumula en `acc` los insumos básicos que consume `receta` para `porciones` porciones (o unidades, si es sub-receta). */
function expandir(cat: Catalogo, receta: Receta, porciones: Decimal, pila: string[], acc: Map<string, Decimal>): void {
  if (pila.includes(receta.id)) throw new CicloDeRecetas([...pila, receta.id]);
  if (pila.length >= MAX_PROFUNDIDAD) throw new RecetaInvalida('Las sub-recetas están anidadas demasiado profundo.');
  const rend = new Decimal(receta.rendimiento);
  if (!rend.gt(0)) throw new RecetaInvalida('El rendimiento de la receta debe ser mayor a cero.');
  const escala = porciones.div(rend).mul(new Decimal(1).plus(new Decimal(receta.mermaPct).div(100)));
  for (const l of receta.lineas) {
    const insumo = cat.insumos[l.insumoId];
    if (!insumo) throw new RecetaInvalida(`Insumo desconocido en la receta: ${l.insumoId}`);
    const enUnidadDelInsumo = convertir(new Decimal(l.cantidad).mul(escala), l.unidad, insumo.unidad, cat.unidades);
    const sub = cat.subRecetaDeInsumo[l.insumoId];
    if (sub) expandir(cat, sub, enUnidadDelInsumo, [...pila, receta.id], acc);
    else acc.set(l.insumoId, (acc.get(l.insumoId) ?? new Decimal(0)).plus(enUnidadDelInsumo));
  }
}

/** Insumos básicos que consume una receta para `porciones` porciones (en la unidad de cada insumo). */
export function consumo(cat: Catalogo, receta: Receta, porciones: Decimal.Value): Map<string, Decimal> {
  const acc = new Map<string, Decimal>();
  expandir(cat, receta, new Decimal(porciones), [], acc);
  return acc;
}

export interface Requerimientos { requerido: Map<string, Decimal>; sinReceta: string[] }

/** Lista consolidada de insumos para el plan del día: suma por insumo, ya convertida y con merma. */
export function requerimientos(plan: { platoId: string; porciones: Decimal.Value }[], cat: Catalogo): Requerimientos {
  const requerido = new Map<string, Decimal>(); const sinReceta: string[] = [];
  for (const p of plan) {
    const receta = cat.recetaDePlato[p.platoId];
    if (!receta) { sinReceta.push(p.platoId); continue; }
    for (const [id, q] of consumo(cat, receta, p.porciones)) requerido.set(id, (requerido.get(id) ?? new Decimal(0)).plus(q));
  }
  return { requerido, sinReceta };
}

/** faltante = máx(0, requerido − stock disponible). Un insumo sin stock registrado cuenta como cero. */
export function faltantes(requerido: Map<string, Decimal>, stock: Record<string, Decimal.Value>): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const [id, q] of requerido) { const f = q.minus(new Decimal(stock[id] ?? 0)); if (f.gt(0)) out.set(id, f); }
  return out;
}

/** Costo de UNA porción: suma de (cantidad básica × costo del insumo), incluida la merma y las sub-recetas. */
export function costoPorPorcion(cat: Catalogo, receta: Receta, costos: Record<string, Decimal.Value>): Decimal {
  let total = new Decimal(0);
  for (const [id, q] of consumo(cat, receta, 1)) total = total.plus(q.mul(new Decimal(costos[id] ?? 0)));
  return total;
}

/** Margen sobre el precio de venta, en porcentaje. Sin precio no hay margen que medir. */
export function margenPct(precio: Decimal.Value, costo: Decimal.Value): Decimal | null {
  const p = new Decimal(precio);
  return p.gt(0) ? p.minus(costo).div(p).mul(100) : null;
}

/** Verifica que una receta nueva no cree un ciclo con las sub-recetas existentes. Lanza CicloDeRecetas. */
export function validarSinCiclos(cat: Catalogo, receta: Receta): void { consumo(cat, receta, 1); }

export const r3 = (d: Decimal) => d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
export const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const r4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
