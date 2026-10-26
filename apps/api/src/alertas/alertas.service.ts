import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { auditar } from '../comun/auditoria';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { EstadisticasService } from '../estadisticas/estadisticas.service';
import { sumarDias } from '../estadisticas/proyeccion';
import { costoPorPorcion } from '../recetas/motor';
import { RecetasService } from '../recetas/recetas.service';
import { EventosGateway, salas } from '../tiempo-real/eventos.gateway';
import { PushService } from '../tiempo-real/push.service';

export const LIMITE_MERMA_PCT = 5;
const MINIMO_VENTAS_PARA_ALERTAR = 100;      // Bs: con menos movimiento, los porcentajes engañan
const CAIDA_VENTAS_PCT = 60;                 // ayer vendió menos del 60 % de lo habitual del mismo día

export type Severidad = 'info' | 'media' | 'alta';
interface Deseada { clave: string; severidad: Severidad; mensaje: string; datos: Record<string, unknown> }
interface Abierta { id: string; severity: Severidad; message: string; clave: string }

const r2 = (n: Decimal.Value) => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/**
 * Alertas con explicación: cada una dice qué pasa, con qué números y contra qué límite. Se revisan cada pocos minutos y a pedido. Las que
 * dependen del estado actual (demora, merma, margen) se resuelven solas cuando el problema se corrige; la caída de ventas queda como aviso.
 */
@Injectable()
export class AlertasService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Alertas');
  private reloj?: NodeJS.Timeout;
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb, @Inject(BD) private readonly bd: Bd, @Inject(RecetasService) private readonly recetas: RecetasService,
    @Inject(EstadisticasService) private readonly est: EstadisticasService, @Inject(EventosGateway) private readonly eventos: EventosGateway, @Inject(PushService) private readonly push: PushService,
  ) {}

  onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    this.reloj = setInterval(() => {
      void (async () => {
        try {
          const rs = (await this.bd.execute(sql`SELECT id FROM restaurants WHERE status = 'activo'`)).rows as { id: string }[];
          for (const r of rs) { const t = { restaurantId: r.id, restaurantIds: [] }; await this.db.run(t, (tx) => this.evaluarTx(tx, t)); }
        } catch (e) { this.log.error(`No se pudieron revisar las alertas: ${(e as Error).message}`); }
      })();
    }, 180_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  private async tz(tx: Bd, rid: string) { return ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${rid}`)).rows[0] as { timezone: string }).timezone; }

  /** Deja abiertas exactamente las alertas deseadas de ese tipo: crea las nuevas, actualiza las que cambiaron y (si corresponde) resuelve las que ya no aplican. */
  private async sincronizar(tx: Bd, t: Tenant, tipo: string, deseadas: Deseada[], resolverSobrantes = true): Promise<Deseada[]> {
    const abiertas = (await tx.execute(sql`SELECT id, severity, message, data->>'clave' AS clave FROM alerts WHERE restaurant_id = ${t.restaurantId} AND kind = ${tipo} AND resolved_at IS NULL`)).rows as unknown as Abierta[];
    const nuevas: Deseada[] = [];
    for (const d of deseadas) {
      const a = abiertas.find((x) => x.clave === d.clave);
      const datos = JSON.stringify({ ...d.datos, clave: d.clave });
      if (!a) {
        await tx.execute(sql`INSERT INTO alerts (restaurant_id, kind, severity, message, data) VALUES (${t.restaurantId}, ${tipo}, ${d.severidad}, ${d.mensaje}, ${datos}::jsonb)`);
        nuevas.push(d);
      } else if (a.message !== d.mensaje || a.severity !== d.severidad) {
        await tx.execute(sql`UPDATE alerts SET message = ${d.mensaje}, severity = ${d.severidad}, data = ${datos}::jsonb WHERE id = ${a.id}`);
      }
    }
    if (resolverSobrantes) {
      const vivas = new Set(deseadas.map((d) => d.clave));
      for (const a of abiertas) if (a.clave && !vivas.has(a.clave)) await tx.execute(sql`UPDATE alerts SET resolved_at = now() WHERE id = ${a.id}`);
    }
    return nuevas;
  }

  /* ---------------- reglas ---------------- */

  /** Pedidos que llevan en cocina más que la meta de su plato más lento (meta = 1,5 × minutos de preparación del menú, o 15 si no tiene). */
  private async demoraDeCocina(tx: Bd, t: Tenant): Promise<Deseada[]> {
    const r = (await tx.execute(sql`SELECT o.id, o.ticket_number, tb.number AS mesa, round(extract(epoch FROM (now() - min(i.sent_at))) / 60)::int AS minutos,
        GREATEST(max(COALESCE(m.prep_minutes, 10)) * 1.5, 15)::int AS umbral, (array_agg(m.name ORDER BY COALESCE(m.prep_minutes, 10) DESC))[1] AS plato
      FROM orders o JOIN order_items i ON i.order_id = o.id JOIN menu_items m ON m.id = i.menu_item_id LEFT JOIN restaurant_tables tb ON tb.id = o.table_id
      WHERE o.restaurant_id = ${t.restaurantId} AND o.status IN ('enviado', 'en_preparacion') AND i.status IN ('enviado', 'en_preparacion') AND i.voided_at IS NULL AND i.sent_at IS NOT NULL
      GROUP BY o.id, o.ticket_number, tb.number
      HAVING extract(epoch FROM (now() - min(i.sent_at))) / 60 > GREATEST(max(COALESCE(m.prep_minutes, 10)) * 1.5, 15)`)).rows as { id: string; ticket_number: number | null; mesa: string | null; minutos: number; umbral: number; plato: string }[];
    return r.map((x) => ({
      clave: x.id, severidad: x.minutos > x.umbral * 2 ? 'alta' : 'media',
      mensaje: `El pedido ${x.ticket_number ? `#${x.ticket_number}` : ''}${x.mesa ? ` (mesa ${x.mesa})` : ''} lleva ${x.minutos} min en cocina; el límite para «${x.plato}» es ${x.umbral} min.`.replace('pedido  (', 'pedido ('),
      datos: { pedidoId: x.id, ticket: x.ticket_number, mesa: x.mesa, minutosEnCocina: x.minutos, limiteMinutos: x.umbral, platoMasLento: x.plato },
    }));
  }

  /** Merma de los últimos 7 días sobre las ventas del mismo período. */
  private async mermaAlta(tx: Bd, t: Tenant, hoy: string): Promise<Deseada[]> {
    const tz = await this.tz(tx, t.restaurantId); const desde = sumarDias(hoy, -6);
    const v = (await tx.execute(sql`SELECT COALESCE((SELECT SUM(amount) FROM sales_payments WHERE restaurant_id = ${t.restaurantId} AND voided_at IS NULL AND (paid_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hoy}::date), 0)::numeric(14,2)::text AS ingresos,
        COALESCE((SELECT SUM(-qty * COALESCE(unit_cost, 0)) FROM stock_movements WHERE restaurant_id = ${t.restaurantId} AND kind = 'merma' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hoy}::date), 0)::numeric(14,2)::text AS merma`)).rows[0] as { ingresos: string; merma: string };
    const ing = new Decimal(v.ingresos); const mer = new Decimal(v.merma);
    if (ing.lt(MINIMO_VENTAS_PARA_ALERTAR) || mer.lte(0)) return [];
    const pct = mer.div(ing).mul(100);
    if (pct.lte(LIMITE_MERMA_PCT)) return [];
    const top = (await tx.execute(sql`SELECT i.name, SUM(-m.qty * COALESCE(m.unit_cost, 0))::numeric(14,2)::text AS valor FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id
      WHERE m.restaurant_id = ${t.restaurantId} AND m.kind = 'merma' AND (m.created_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hoy}::date GROUP BY i.name ORDER BY SUM(-m.qty * COALESCE(m.unit_cost, 0)) DESC LIMIT 3`)).rows as { name: string; valor: string }[];
    return [{
      clave: 'semana', severidad: pct.gt(LIMITE_MERMA_PCT * 2) ? 'alta' : 'media',
      mensaje: `Merma alta: Bs ${r2(mer)} en los últimos 7 días, ${r2(pct)} % de las ventas (el límite es ${LIMITE_MERMA_PCT} %).${top.length ? ` Lo que más pesó: ${top.map((x) => `${x.name} (Bs ${x.valor})`).join(', ')}.` : ''}`,
      datos: { desde, hasta: hoy, merma: r2(mer), ingresos: r2(ing), mermaPct: r2(pct), limitePct: LIMITE_MERMA_PCT, masPesados: top },
    }];
  }

  /** Platos con receta cuyo margen está por debajo del mínimo de la sucursal. */
  private async margenBajo(tx: Bd, t: Tenant): Promise<Deseada[]> {
    const min = new Decimal(((await tx.execute(sql`SELECT min_margin_pct::text AS m FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { m: string }).m);
    const platos = (await tx.execute(sql`SELECT id, name, price::text AS price FROM menu_items WHERE restaurant_id = ${t.restaurantId} AND available AND price > 0`)).rows as { id: string; name: string; price: string }[];
    const cat = await this.recetas.catalogo(tx, t); const costos = await this.recetas.costos(tx, t); const out: Deseada[] = [];
    for (const p of platos) {
      const receta = cat.recetaDePlato[p.id]; if (!receta) continue;
      let cpp: Decimal; try { cpp = costoPorPorcion(cat, receta, costos); } catch { continue; }
      const margen = new Decimal(p.price).minus(cpp).div(p.price).mul(100);
      if (margen.gte(min)) continue;
      out.push({ clave: p.id, severidad: margen.lt(0) ? 'alta' : 'media',
        mensaje: `«${p.name}» tiene margen de ${r2(margen)} %, por debajo del mínimo de ${r2(min)} %: cuesta Bs ${r2(cpp)} y se vende a Bs ${r2(p.price)}.`,
        datos: { platoId: p.id, plato: p.name, precio: r2(p.price), costoPorPorcion: r2(cpp), margenPct: r2(margen), minimoPct: r2(min) } });
    }
    return out;
  }

  /** Ayer contra lo habitual de ese mismo día de la semana (promedio de las 4 semanas anteriores). Queda como aviso: no se resuelve sola. */
  private async ventasBajas(tx: Bd, t: Tenant, hoy: string): Promise<Deseada[]> {
    const ayer = sumarDias(hoy, -1);
    await this.est.calcular(tx, t, sumarDias(ayer, -28), ayer);
    const r = (await tx.execute(sql`SELECT day::text AS dia, revenue::float8 AS ingresos FROM kpi_daily WHERE restaurant_id = ${t.restaurantId} AND day BETWEEN ${sumarDias(ayer, -28)}::date AND ${ayer}::date`)).rows as { dia: string; ingresos: number }[];
    const ayerV = r.find((x) => x.dia === ayer)?.ingresos ?? 0;
    const previos = [7, 14, 21, 28].map((k) => r.find((x) => x.dia === sumarDias(ayer, -k))?.ingresos ?? 0).filter((v) => v > 0);
    if (previos.length < 3) return [];
    const habitual = previos.reduce((s, v) => s + v, 0) / previos.length;
    if (habitual < MINIMO_VENTAS_PARA_ALERTAR || ayerV >= habitual * (CAIDA_VENTAS_PCT / 100)) return [];
    const pct = (ayerV / habitual) * 100;
    return [{ clave: ayer, severidad: 'media', mensaje: `Ayer (${ayer}) se vendió Bs ${r2(ayerV)}, solo el ${r2(pct)} % de lo habitual para ese día (Bs ${r2(habitual)}).`,
      datos: { fecha: ayer, ventas: r2(ayerV), habitual: r2(habitual), porcentaje: r2(pct), limitePct: CAIDA_VENTAS_PCT, semanasComparadas: previos.length } }];
  }

  /* ---------------- evaluación ---------------- */

  async evaluarTx(tx: Bd, t: Tenant): Promise<{ nuevas: number }> {
    const tz = await this.tz(tx, t.restaurantId);
    const hoy = ((await tx.execute(sql`SELECT (now() AT TIME ZONE ${tz})::date::text AS d`)).rows[0] as { d: string }).d;
    const nuevas = [
      ...(await this.sincronizar(tx, t, 'demora_cocina', await this.demoraDeCocina(tx, t))).map((n) => ({ tipo: 'demora_cocina', ...n })),
      ...(await this.sincronizar(tx, t, 'merma_alta', await this.mermaAlta(tx, t, hoy))).map((n) => ({ tipo: 'merma_alta', ...n })),
      ...(await this.sincronizar(tx, t, 'margen_bajo', await this.margenBajo(tx, t))).map((n) => ({ tipo: 'margen_bajo', ...n })),
      ...(await this.sincronizar(tx, t, 'ventas_bajas', await this.ventasBajas(tx, t, hoy), false)).map((n) => ({ tipo: 'ventas_bajas', ...n })),
    ];
    if (nuevas.length) {
      this.eventos.emitir(salas.sucursal(t.restaurantId), 'alerta.nueva', { cantidad: nuevas.length });
      const graves = nuevas.filter((n) => n.severidad === 'alta');
      if (graves.length) {
        const dest = (await tx.execute(sql`SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.restaurant_id = ${t.restaurantId} AND ro.code IN ('owner','admin')`)).rows as { user_id: string }[];
        void this.push.avisar(dest.map((d) => d.user_id), { titulo: 'Alerta importante', cuerpo: graves[0].mensaje.slice(0, 160), url: '/app/alertas', etiqueta: `alerta-${t.restaurantId}` });
      }
    }
    return { nuevas: nuevas.length };
  }

  evaluar(t: Tenant, por: string) {
    return this.db.run(t, async (tx) => { const r = await this.evaluarTx(tx, t); await auditar(tx, t.restaurantId, por, 'alertas.revisadas', 'restaurant', t.restaurantId, r); return r; });
  }

  lista(t: Tenant, q: { estado: 'abiertas' | 'resueltas' | 'todas'; tipo?: string }) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT id, kind, severity, message, data, created_at, resolved_at FROM alerts WHERE restaurant_id = ${t.restaurantId}
          AND (${q.estado} = 'todas' OR (${q.estado} = 'abiertas' AND resolved_at IS NULL) OR (${q.estado} = 'resueltas' AND resolved_at IS NOT NULL)) AND (${q.tipo ?? null}::text IS NULL OR kind = ${q.tipo ?? null})
        ORDER BY (resolved_at IS NULL) DESC, CASE severity WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, created_at DESC LIMIT 200`);
      return (r.rows as { id: string; kind: string; severity: Severidad; message: string; data: Record<string, unknown> | null; created_at: Date; resolved_at: Date | null }[])
        .map((a) => ({ id: a.id, tipo: a.kind, severidad: a.severity, mensaje: a.message, datos: a.data, creada: new Date(a.created_at).toISOString(), resuelta: a.resolved_at ? new Date(a.resolved_at).toISOString() : null }));
    });
  }

  resolver(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`UPDATE alerts SET resolved_at = now() WHERE id = ${id} AND restaurant_id = ${t.restaurantId} AND resolved_at IS NULL RETURNING id`);
      if (!r.rows.length) throw new NotFoundException('Alerta no encontrada o ya resuelta.');
      await auditar(tx, t.restaurantId, por, 'alertas.resuelta', 'alert', id);
      return { ok: true };
    });
  }
}
