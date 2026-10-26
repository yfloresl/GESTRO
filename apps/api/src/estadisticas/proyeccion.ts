/**
 * Proyección de ventas: funciones PURAS. Estacionalidad por día de la semana (promedio con más peso en lo reciente), tendencia semanal
 * acotada y una banda de confianza del 80 % que se ensancha con el horizonte. Con menos de 8 semanas de historia NO da cifras:
 * «datos insuficientes» es mejor que un número engañoso.
 */
export interface Punto { fecha: string; valor: number }
export interface DiaProyectado { fecha: string; valor: number; bajo: number; alto: number }
export interface SemanaProyectada { desde: string; hasta: string; valor: number; bajo: number; alto: number }
export type Confianza = 'alta' | 'media' | 'baja';
export type Proyeccion =
  | { suficiente: false; diasHistoria: number; semanasHistoria: number; minimoSemanas: number; motivo: string }
  | { suficiente: true; diasHistoria: number; semanasHistoria: number; confianza: Confianza; crecimientoSemanalPct: number; variacion: number; diario: DiaProyectado[]; semanas: SemanaProyectada[]; total: { valor: number; bajo: number; alto: number } };

export const MINIMO_SEMANAS = 8;
const VENTANA_DIAS = 84;       // 12 semanas
const ALFA = 0.3;              // peso de lo reciente
const Z80 = 1.2816;            // banda del 80 %
const TOPE_TENDENCIA = 0.05;   // ±5 % por semana como máximo

const MS = 86_400_000;
const t0 = (f: string) => Date.parse(`${f}T12:00:00Z`);
export const sumarDias = (f: string, d: number) => new Date(t0(f) + d * MS).toISOString().slice(0, 10);
export const diaIso = (f: string) => { const d = new Date(t0(f)).getUTCDay(); return d === 0 ? 7 : d; };
const redondear = (n: number) => Math.round(n * 100) / 100;

function ponderado(valores: number[]): { media: number; desvio: number } {
  const n = valores.length; let sw = 0; let sm = 0;
  const w = valores.map((_, k) => (1 - ALFA) ** (n - 1 - k));
  valores.forEach((v, k) => { sw += w[k]; sm += w[k] * v; });
  const media = sm / sw; let sv = 0;
  valores.forEach((v, k) => { sv += w[k] * (v - media) ** 2; });
  return { media, desvio: Math.sqrt(sv / sw) };
}

/** `serie`: ingresos por día, consecutivos y ya con ceros en los días sin ventas, hasta ayer. `desde`: primer día a proyectar. */
export function proyectar(serie: Punto[], desde: string, semanas = 4): Proyeccion {
  const dias = serie.length; const sem = Math.floor(dias / 7);
  if (sem < MINIMO_SEMANAS) return { suficiente: false, diasHistoria: dias, semanasHistoria: sem, minimoSemanas: MINIMO_SEMANAS, motivo: `Hay ${sem} semana(s) de historia y se necesitan al menos ${MINIMO_SEMANAS} para proyectar sin engañar.` };

  const usadas = serie.slice(-VENTANA_DIAS);
  const porDia = new Map<number, number[]>();
  for (const p of usadas) { const k = diaIso(p.fecha); porDia.set(k, [...(porDia.get(k) ?? []), p.valor]); }
  const est = new Map([...porDia].map(([k, v]) => [k, ponderado(v)]));

  // Tendencia: últimas 4 semanas contra las 4 anteriores, convertida a crecimiento semanal y acotada.
  const suma = (a: Punto[]) => a.reduce((s, p) => s + p.valor, 0);
  const ult = suma(serie.slice(-28)); const prev = suma(serie.slice(-56, -28));
  const g = prev > 0 && ult > 0 ? Math.max(-TOPE_TENDENCIA, Math.min(TOPE_TENDENCIA, (ult / prev) ** (1 / 4) - 1)) : 0;

  const diario: DiaProyectado[] = [];
  for (let i = 0; i < semanas * 7; i++) {
    const fecha = sumarDias(desde, i); const h = Math.floor(i / 7) + 1; const e = est.get(diaIso(fecha)) ?? { media: 0, desvio: 0 };
    const valor = e.media * (1 + g) ** h; const margen = Z80 * e.desvio * Math.sqrt(1 + 0.1 * h);
    diario.push({ fecha, valor: redondear(valor), bajo: redondear(Math.max(0, valor - margen)), alto: redondear(valor + margen) });
  }
  const margenes = diario.map((d) => (d.alto - d.valor));
  const agrupar = (a: DiaProyectado[], m: number[]) => ({ valor: redondear(a.reduce((s, d) => s + d.valor, 0)), err: Math.sqrt(m.reduce((s, x) => s + x * x, 0)) });
  const semanasOut: SemanaProyectada[] = [];
  for (let w = 0; w < semanas; w++) {
    const tr = diario.slice(w * 7, w * 7 + 7); const a = agrupar(tr, margenes.slice(w * 7, w * 7 + 7));
    semanasOut.push({ desde: tr[0].fecha, hasta: tr[6].fecha, valor: a.valor, bajo: redondear(Math.max(0, a.valor - a.err)), alto: redondear(a.valor + a.err) });
  }
  const tot = agrupar(diario, margenes);

  // Confianza: cuántas semanas hay y qué tan parejas fueron.
  const semanasCompletas: number[] = [];
  for (let k = serie.length; k - 7 >= 0 && semanasCompletas.length < 12; k -= 7) semanasCompletas.push(suma(serie.slice(k - 7, k)));
  const media = suma(semanasCompletas.map((v) => ({ fecha: '', valor: v }))) / semanasCompletas.length;
  const cv = media > 0 ? Math.sqrt(semanasCompletas.reduce((s, v) => s + (v - media) ** 2, 0) / semanasCompletas.length) / media : 1;
  const confianza: Confianza = sem >= 12 && cv < 0.25 ? 'alta' : cv < 0.5 ? 'media' : 'baja';
  const reciente = semanasCompletas[0] ?? 0;

  return { suficiente: true, diasHistoria: dias, semanasHistoria: sem, confianza, crecimientoSemanalPct: redondear(g * 100), variacion: reciente > 0 ? redondear(((semanasOut[0].valor - reciente) / reciente) * 100) : 0,
    diario, semanas: semanasOut, total: { valor: tot.valor, bajo: redondear(Math.max(0, tot.valor - tot.err)), alto: redondear(tot.valor + tot.err) } };
}

/** Escenario «¿y si…?»: variación de precio y de demanda (en %) sobre una proyección. El costo sigue a la demanda, no al precio. */
export function escenario(base: { ingresos: number; costo: number }, precioPct: number, demandaPct: number) {
  const f = (1 + precioPct / 100) * (1 + demandaPct / 100);
  const ingresos = base.ingresos * f; const costo = base.costo * (1 + demandaPct / 100);
  return {
    ingresos: redondear(ingresos), costo: redondear(costo), utilidadBruta: redondear(ingresos - costo),
    ingresosVariacion: redondear(ingresos - base.ingresos), utilidadVariacion: redondear((ingresos - costo) - (base.ingresos - base.costo)),
  };
}
