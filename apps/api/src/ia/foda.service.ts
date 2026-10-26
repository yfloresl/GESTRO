import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { EstadisticasService } from '../estadisticas/estadisticas.service';
import { sumarDias } from '../estadisticas/proyeccion';
import { IaService } from './ia.service';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida');
export const GenerarFoda = z.object({ desde: Fecha.optional(), hasta: Fecha.optional() }).strict();

export const MIN_DIAS = 14;
export const MIN_PEDIDOS = 20;
const r2 = (n: Decimal.Value) => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export interface Punto { texto: string; metrica: string }
export interface Evidencia { [clave: string]: { valor: string | number; detalle: string } }
export interface Cuadrantes { fortalezas: Punto[]; debilidades: Punto[]; oportunidades: Punto[]; amenazas: Punto[] }
type Cuadrante = keyof Cuadrantes;
const CUADRANTES: Cuadrante[] = ['fortalezas', 'debilidades', 'oportunidades', 'amenazas'];

/** Números que aparecen en un texto (admite coma o punto decimal). */
export const numerosDe = (s: string): number[] => (s.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(',', '.')));

/**
 * Valida lo que escribió la IA contra los números reales: cada punto debe citar una métrica que exista en la evidencia y TODAS las cifras
 * de su texto deben salir de la evidencia. Lo que no cumple se descarta (la IA no inventa cifras).
 */
export function validarPuntos(candidatos: unknown, evidencia: Evidencia, periodo: { desde: string; hasta: string }): { validos: Cuadrantes; descartados: number } {
  const permitidos = [...numerosDe(JSON.stringify(evidencia)), ...numerosDe(`${periodo.desde} ${periodo.hasta}`)];
  const ok = (n: number) => permitidos.some((p) => Math.abs(p - n) < 0.005);
  const validos: Cuadrantes = { fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] }; let descartados = 0;
  const c = (candidatos ?? {}) as Record<string, unknown>;
  for (const cuad of CUADRANTES) {
    const lista = Array.isArray(c[cuad]) ? (c[cuad] as unknown[]) : [];
    for (const p of lista.slice(0, 6)) {
      const x = p as { texto?: unknown; metrica?: unknown };
      if (typeof x?.texto !== 'string' || typeof x?.metrica !== 'string' || !x.texto.trim() || x.texto.length > 400) { descartados++; continue; }
      if (!(x.metrica in evidencia) || !numerosDe(x.texto).every(ok)) { descartados++; continue; }
      validos[cuad].push({ texto: x.texto.trim(), metrica: x.metrica });
      if (validos[cuad].length >= 4) break;
    }
  }
  return { validos, descartados };
}

/**
 * FODA automático con evidencia. Siempre se arma primero con reglas sobre los indicadores reales (cada punto cita su métrica); si hay IA
 * configurada, Claude redacta y prioriza SOLO con esos agregados y su texto se valida contra los números antes de publicarse. Con pocos
 * datos el informe lo declara en vez de inventar.
 */
@Injectable()
export class FodaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FODA');
  private reloj?: NodeJS.Timeout;
  constructor(@Inject(TenantDb) private readonly db: TenantDb, @Inject(BD) private readonly bd: Bd, @Inject(EstadisticasService) private readonly est: EstadisticasService, @Inject(IaService) private readonly ia: IaService) {}

  /** El día 1 de cada mes (después de las 03:00 en La Paz) se genera el FODA del mes anterior de cada sucursal que aún no lo tenga. */
  onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    this.reloj = setInterval(() => {
      void (async () => {
        const ahora = new Date(Date.now() - 4 * 3_600_000);
        if (ahora.getUTCDate() !== 1 || ahora.getUTCHours() < 3) return;
        const hasta = sumarDias(ahora.toISOString().slice(0, 10), -1); const desde = `${hasta.slice(0, 8)}01`;
        try {
          const rs = (await this.bd.execute(sql`SELECT id FROM restaurants WHERE status = 'activo'`)).rows as { id: string }[];
          for (const r of rs) {
            const t = { restaurantId: r.id, restaurantIds: [] };
            const ya = await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT 1 FROM swot_reports WHERE restaurant_id = ${r.id} AND period_from = ${desde}::date AND period_to = ${hasta}::date`)).rows.length);
            if (!ya) await this.generar(t, null, desde, hasta).catch((e) => this.log.warn(`FODA mensual de ${r.id}: ${(e as Error).message}`));
          }
        } catch (e) { this.log.error(`FODA mensual: ${(e as Error).message}`); }
      })();
    }, 3_600_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /* ---------------- indicadores y reglas ---------------- */

  private async reunir(t: Tenant, desde: string, hasta: string) {
    const [resumen, menu, dias] = await Promise.all([this.est.resumen(t, desde, hasta), this.est.menu(t, desde, hasta), this.est.ventas(t, 'dia_semana', desde, hasta)]);
    const extra = await this.db.run(t, async (tx) => {
      const tz = ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { timezone: string }).timezone;
      const demoras = (await tx.execute(sql`SELECT m.name, m.prep_minutes, round(AVG(extract(epoch FROM (i.ready_at - i.sent_at)) / 60)::numeric, 1)::text AS minutos, count(*)::int AS n
        FROM order_items i JOIN menu_items m ON m.id = i.menu_item_id WHERE i.restaurant_id = ${t.restaurantId} AND i.voided_at IS NULL AND i.sent_at IS NOT NULL AND i.ready_at IS NOT NULL AND m.prep_minutes IS NOT NULL
          AND (i.ready_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY m.id, m.name, m.prep_minutes HAVING count(*) >= 5 ORDER BY AVG(extract(epoch FROM (i.ready_at - i.sent_at)) / 60) / m.prep_minutes DESC LIMIT 3`)).rows as { name: string; prep_minutes: number; minutos: string; n: number }[];
      const alzas = (await tx.execute(sql`SELECT count(*)::int AS n, COALESCE(max((data->>'alzaPct')::numeric), 0)::text AS maxima FROM alerts WHERE restaurant_id = ${t.restaurantId} AND kind = 'precio_alto' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date`)).rows[0] as { n: number; maxima: string };
      const mermaTop = (await tx.execute(sql`SELECT i.name, SUM(-m.qty * COALESCE(m.unit_cost, 0))::numeric(14,2)::text AS valor FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id WHERE m.restaurant_id = ${t.restaurantId} AND m.kind = 'merma'
        AND (m.created_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY i.name ORDER BY SUM(-m.qty * COALESCE(m.unit_cost, 0)) DESC LIMIT 1`)).rows as { name: string; valor: string }[];
      return { demoras, alzas, mermaTop: mermaTop[0] ?? null };
    });
    return { resumen, menu, dias, ...extra };
  }

  /** Arma evidencia y puntos con reglas. Cada punto cita la métrica que lo respalda. */
  private construir(d: Awaited<ReturnType<FodaService['reunir']>>, desde: string, hasta: string): { evidencia: Evidencia; puntos: Cuadrantes } {
    const ev: Evidencia = {}; const p: Cuadrantes = { fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] };
    const a = d.resumen.actual; const ant = d.resumen.anterior; const v = d.resumen.variacion;
    const ing = Number(a.ingresos);
    ev.ingresos = { valor: a.ingresos, detalle: `Ingresos del período: Bs ${a.ingresos} en ${a.pedidos} pedidos (ticket promedio Bs ${a.ticketPromedio}).` };
    if (v.ingresosPct !== null) {
      ev.variacion_ventas = { valor: v.ingresosPct, detalle: `Ingresos Bs ${a.ingresos} contra Bs ${ant.ingresos} del período anterior: ${v.ingresosPct} %.` };
      if (Number(v.ingresosPct) >= 5) p.fortalezas.push({ texto: `Las ventas crecieron ${v.ingresosPct} % frente al período anterior (de Bs ${ant.ingresos} a Bs ${a.ingresos}).`, metrica: 'variacion_ventas' });
      if (Number(v.ingresosPct) <= -5) p.debilidades.push({ texto: `Las ventas bajaron ${Math.abs(Number(v.ingresosPct))} % frente al período anterior (de Bs ${ant.ingresos} a Bs ${a.ingresos}).`, metrica: 'variacion_ventas' });
    }
    if (v.ticketPct !== null && Number(v.ticketPct) >= 5) { ev.variacion_ticket = { valor: v.ticketPct, detalle: `Ticket promedio Bs ${a.ticketPromedio} contra Bs ${ant.ticketPromedio}: ${v.ticketPct} %.` }; p.fortalezas.push({ texto: `El ticket promedio subió ${v.ticketPct} % (de Bs ${ant.ticketPromedio} a Bs ${a.ticketPromedio}).`, metrica: 'variacion_ticket' }); }
    if (a.costoAlimentosPct !== null) {
      ev.costo_alimentos = { valor: a.costoAlimentosPct, detalle: `Costo de alimentos ${a.costoAlimentosPct} % de las ventas (antes ${ant.costoAlimentosPct ?? 'sin dato'} %).` };
      if (ant.costoAlimentosPct !== null) {
        const dif = Number(a.costoAlimentosPct) - Number(ant.costoAlimentosPct);
        if (dif <= -2) p.fortalezas.push({ texto: `El costo de alimentos bajó de ${ant.costoAlimentosPct} % a ${a.costoAlimentosPct} % de las ventas.`, metrica: 'costo_alimentos' });
        if (dif >= 2) p.amenazas.push({ texto: `El costo de alimentos subió de ${ant.costoAlimentosPct} % a ${a.costoAlimentosPct} % de las ventas.`, metrica: 'costo_alimentos' });
      }
    }
    // Merma
    if (ing > 0) {
      const pct = (Number(a.merma) / ing) * 100;
      ev.merma = { valor: r2(pct), detalle: `Merma Bs ${a.merma} = ${r2(pct)} % de las ventas (el límite es 5 %).${d.mermaTop ? ` Lo que más pesó: ${d.mermaTop.name} (Bs ${d.mermaTop.valor}).` : ''}` };
      if (pct > 5) p.debilidades.push({ texto: `La merma fue Bs ${a.merma}, ${r2(pct)} % de las ventas (el límite es 5 %).${d.mermaTop ? ` Lo que más pesó: ${d.mermaTop.name} (Bs ${d.mermaTop.valor}).` : ''}`, metrica: 'merma' });
    }
    // Menú
    const clase = (c: string) => d.menu.platos.filter((x) => x.clase === c);
    const estrellas = clase('estrella').sort((x, y) => Number(y.ventas) - Number(x.ventas));
    if (estrellas[0]) { const e = estrellas[0]; ev.plato_estrella = { valor: e.margenPct ?? '', detalle: `${e.nombre}: ${Number(e.unidades)} unidades, ventas Bs ${e.ventas}, margen ${e.margenPct} %.` }; p.fortalezas.push({ texto: `«${e.nombre}» es plato estrella: ${Number(e.unidades)} unidades vendidas con margen de ${e.margenPct} %.`, metrica: 'plato_estrella' }); }
    const caballos = clase('caballo');
    if (caballos[0]) { const e = caballos[0]; ev.plato_caballo = { valor: e.margenPct ?? '', detalle: `${e.nombre}: ${Number(e.unidades)} unidades pero margen de solo ${e.margenPct} % (costo Bs ${e.costoPorPorcion}, precio promedio Bs ${e.precioPromedio}).` }; p.debilidades.push({ texto: `«${e.nombre}» se pide mucho (${Number(e.unidades)} unidades) pero deja solo ${e.margenPct} % de margen: cuesta Bs ${e.costoPorPorcion} y se vende a Bs ${e.precioPromedio}.`, metrica: 'plato_caballo' }); }
    const perros = clase('perro');
    if (perros.length) { ev.platos_perro = { valor: perros.length, detalle: `${perros.length} plato(s) con poca venta y poco margen: ${perros.slice(0, 3).map((x) => x.nombre).join(', ')}.` }; p.debilidades.push({ texto: `${perros.length} plato(s) venden poco y dejan poco margen: ${perros.slice(0, 3).map((x) => `«${x.nombre}»`).join(', ')}.`, metrica: 'platos_perro' }); }
    const puzzles = clase('puzzle').sort((x, y) => Number(y.margenPct) - Number(x.margenPct));
    if (puzzles[0]) { const e = puzzles[0]; ev.plato_puzzle = { valor: e.margenPct ?? '', detalle: `${e.nombre}: margen ${e.margenPct} % pero solo ${Number(e.unidades)} unidades vendidas.` }; p.oportunidades.push({ texto: `«${e.nombre}» tiene margen de ${e.margenPct} % pero se vendió poco (${Number(e.unidades)} unidades): conviene darle más visibilidad.`, metrica: 'plato_puzzle' }); }
    const top = d.menu.platos[0];
    if (top && ing > 0) { const parte = (Number(top.ventas) / ing) * 100; ev.dependencia = { valor: r2(parte), detalle: `${top.nombre} concentra el ${r2(parte)} % de las ventas (Bs ${top.ventas}).` }; if (parte > 35) p.debilidades.push({ texto: `«${top.nombre}» concentra el ${r2(parte)} % de las ventas: hay dependencia de un solo plato.`, metrica: 'dependencia' }); }
    // Demoras de cocina
    for (const [i, m] of d.demoras.entries()) {
      if (Number(m.minutos) > m.prep_minutes * 1.3) {
        const k = `demora_${i + 1}`; ev[k] = { valor: m.minutos, detalle: `${m.name}: ${m.minutos} min de promedio contra ${m.prep_minutes} de meta, en ${m.n} pedidos.` };
        p.debilidades.push({ texto: `«${m.name}» tarda ${m.minutos} min en promedio contra ${m.prep_minutes} min de meta (${m.n} pedidos).`, metrica: k });
      }
    }
    // Días flojos
    const diasV = d.dias.filas.filter((f) => Number(f.ventas) > 0);
    if (diasV.length >= 3) {
      const orden = [...diasV].sort((x, y) => Number(x.ventas) - Number(y.ventas)); const bajo = orden[0]; const alto = orden[orden.length - 1];
      const rel = (Number(bajo.ventas) / Number(alto.ventas)) * 100;
      ev.dia_bajo = { valor: r2(rel), detalle: `${bajo.etiqueta}: Bs ${bajo.ventas} en el período, ${r2(rel)} % de lo que vende ${alto.etiqueta} (Bs ${alto.ventas}).` };
      if (rel < 50) p.oportunidades.push({ texto: `Los ${bajo.etiqueta.toLowerCase()} venden Bs ${bajo.ventas}, solo ${r2(rel)} % de un ${alto.etiqueta.toLowerCase()} (Bs ${alto.ventas}): hay capacidad libre para promociones o eventos.`, metrica: 'dia_bajo' });
    }
    // Alzas de proveedores
    if (d.alzas.n > 0) { ev.alzas_proveedor = { valor: d.alzas.n, detalle: `${d.alzas.n} alza(s) de precio de proveedores en el período; la mayor, ${d.alzas.maxima} %.` }; p.amenazas.push({ texto: `Se registraron ${d.alzas.n} alza(s) de precios de proveedores; la mayor fue de ${d.alzas.maxima} %.`, metrica: 'alzas_proveedor' }); }
    // Caída sostenida: tres semanas seguidas bajando
    const s = d.resumen.serie.map((x) => Number(x.ingresos));
    if (s.length >= 21) {
      const w = [0, 1, 2].map((k) => s.slice(s.length - 7 * (k + 1), s.length - 7 * k).reduce((x, y) => x + y, 0)).reverse();   // de la más antigua a la más reciente
      if (w[0] > w[1] && w[1] > w[2] && w[0] > 0) { ev.caida_sostenida = { valor: r2(w[2]), detalle: `Ventas de las últimas tres semanas: Bs ${r2(w[0])}, Bs ${r2(w[1])} y Bs ${r2(w[2])}.` }; p.amenazas.push({ texto: `Las ventas bajaron tres semanas seguidas: Bs ${r2(w[0])}, Bs ${r2(w[1])} y Bs ${r2(w[2])}.`, metrica: 'caida_sostenida' }); }
    }
    void desde; void hasta;
    return { evidencia: ev, puntos: p };
  }

  /** Pide a Claude que redacte y priorice con SOLO esos agregados. Devuelve null si no hay IA o si nada de lo que escribió pasa la validación. */
  private async redactar(t: Tenant, evidencia: Evidencia, base: Cuadrantes, periodo: { desde: string; hasta: string }): Promise<{ puntos: Cuadrantes; modelo: string; descartados: number } | null> {
    if (!(await this.ia.disponible())) return null;
    const sistema = 'Eres analista de restaurantes. Redactas un análisis FODA en español claro y directo para el dueño. Reglas: usa SOLO las cifras de "evidencia"; cada punto cita UNA clave de "evidencia" en "metrica"; no inventes cifras, causas ni comparaciones que no estén en la evidencia; máximo 4 puntos por cuadrante; si un cuadrante no tiene respaldo, devuelve una lista vacía. Puedes reformular y ordenar por importancia los "puntos_base". Responde SOLO un objeto JSON con las claves fortalezas, debilidades, oportunidades y amenazas; cada una es una lista de {"texto": string, "metrica": string}.';
    const r = await this.ia.enviar('foda', 'foda', { sistema, mensajes: [{ role: 'user', content: JSON.stringify({ periodo, evidencia, puntos_base: base }) }], maxTokens: 1500 }, t);
    const texto = r.bloques.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    const { validos, descartados } = validarPuntos(IaService.extraerJson(texto), evidencia, periodo);
    if (!CUADRANTES.some((c) => validos[c].length)) return null;
    return { puntos: validos, modelo: r.modelo, descartados };
  }

  /* ---------------- API ---------------- */

  async generar(t: Tenant, por: string | null, desde: string, hasta: string) {
    if (hasta < desde) throw new BadRequestException('«Hasta» no puede ser anterior a «desde».');
    const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
    if (dias > 92) throw new BadRequestException('El período máximo es de 92 días.');
    const datos = await this.reunir(t, desde, hasta);
    let evidencia: Evidencia = {}; let puntos: Cuadrantes = { fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] };
    const insuficiente = dias < MIN_DIAS || datos.resumen.actual.pedidos < MIN_PEDIDOS;
    let modelo = 'reglas'; let motivo: string | null = null; let descartados = 0; let iaError: string | null = null;
    if (insuficiente) {
      motivo = `Datos insuficientes: hay ${datos.resumen.actual.pedidos} pedido(s) cobrados en ${dias} día(s) y se necesitan al menos ${MIN_PEDIDOS} pedidos en ${MIN_DIAS} días para un análisis que no engañe.`;
      evidencia = { datos_insuficientes: { valor: datos.resumen.actual.pedidos, detalle: motivo } };
    } else {
      const c = this.construir(datos, desde, hasta); evidencia = c.evidencia; puntos = c.puntos;
      try { const r = await this.redactar(t, evidencia, puntos, { desde, hasta }); if (r) { puntos = r.puntos; modelo = r.modelo; descartados = r.descartados; } }
      catch (e) { iaError = (e as Error).message; this.log.warn(`FODA sin IA, se usan las reglas: ${iaError}`); }
      if (!CUADRANTES.some((q) => puntos[q].length)) motivo = 'Con los datos de este período no se encontraron señales claras en ninguna de las cuatro áreas.';
    }
    const guardado = await this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`INSERT INTO swot_reports (restaurant_id, period_from, period_to, strengths, weaknesses, opportunities, threats, evidence, model)
        VALUES (${t.restaurantId}, ${desde}::date, ${hasta}::date, ${JSON.stringify(puntos.fortalezas)}::jsonb, ${JSON.stringify(puntos.debilidades)}::jsonb, ${JSON.stringify(puntos.oportunidades)}::jsonb, ${JSON.stringify(puntos.amenazas)}::jsonb,
          ${JSON.stringify({ ...evidencia, _meta: { detalle: motivo ?? '', valor: motivo ? 'insuficiente' : 'ok', descartados, iaError } })}::jsonb, ${modelo}) RETURNING id, created_at`)).rows[0] as { id: string; created_at: Date };
      await auditar(tx, t.restaurantId, por, 'foda.generado', 'swot_report', r.id, { desde, hasta, modelo });
      return r;
    });
    return { id: guardado.id, desde, hasta, modelo, creado: new Date(guardado.created_at).toISOString(), suficiente: !insuficiente, motivo, ...puntos, evidencia, descartadosPorValidacion: descartados, iaNoDisponible: iaError };
  }

  private vista(r: { id: string; period_from: string; period_to: string; strengths: Punto[]; weaknesses: Punto[]; opportunities: Punto[]; threats: Punto[]; evidence: Evidencia & { _meta?: { detalle: string; valor: string; descartados: number; iaError: string | null } }; model: string; created_at: Date }) {
    const { _meta, ...evidencia } = r.evidence ?? {};
    const motivo = _meta?.valor === 'insuficiente' ? _meta.detalle : (!(r.strengths?.length || r.weaknesses?.length || r.opportunities?.length || r.threats?.length) ? (_meta?.detalle || 'Sin señales claras.') : null);
    return { id: r.id, desde: r.period_from, hasta: r.period_to, modelo: r.model, creado: new Date(r.created_at).toISOString(), suficiente: _meta?.valor !== 'insuficiente', motivo,
      fortalezas: r.strengths ?? [], debilidades: r.weaknesses ?? [], oportunidades: r.opportunities ?? [], amenazas: r.threats ?? [], evidencia, descartadosPorValidacion: _meta?.descartados ?? 0, iaNoDisponible: _meta?.iaError ?? null };
  }

  lista(t: Tenant) {
    return this.db.run(t, async (tx) => (await tx.execute(sql`SELECT id, period_from::text AS period_from, period_to::text AS period_to, model, created_at,
        (jsonb_array_length(COALESCE(strengths, '[]')) + jsonb_array_length(COALESCE(weaknesses, '[]')) + jsonb_array_length(COALESCE(opportunities, '[]')) + jsonb_array_length(COALESCE(threats, '[]')))::int AS puntos
      FROM swot_reports WHERE restaurant_id = ${t.restaurantId} ORDER BY created_at DESC LIMIT 24`)).rows.map((r) => { const x = r as { id: string; period_from: string; period_to: string; model: string; created_at: Date; puntos: number }; return { id: x.id, desde: x.period_from, hasta: x.period_to, modelo: x.model, creado: new Date(x.created_at).toISOString(), puntos: x.puntos }; }));
  }

  ver(t: Tenant, id: string) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT id, period_from::text AS period_from, period_to::text AS period_to, strengths, weaknesses, opportunities, threats, evidence, model, created_at FROM swot_reports WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows[0];
      if (!r) throw new NotFoundException('Informe no encontrado.');
      return this.vista(r as Parameters<FodaService['vista']>[0]);
    });
  }
}
