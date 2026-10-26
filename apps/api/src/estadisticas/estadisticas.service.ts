import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { uuidArray } from '../comun/sql';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { costoPorPorcion } from '../recetas/motor';
import { RecetasService } from '../recetas/recetas.service';
import { escenario, proyectar, sumarDias } from './proyeccion';

const MAX_DIAS = 92;
const r2 = (n: Decimal.Value) => new Decimal(n).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export const GRUPOS = ['hora', 'dia_semana', 'plato', 'categoria', 'mesero', 'canal', 'tipo'] as const;
export type Grupo = (typeof GRUPOS)[number];
const DIA = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const CANAL: Record<string, string> = { mesero: 'Mesero', caja: 'Caja', qr_mesa: 'QR de mesa', web: 'Web', evento: 'Evento' };
const TIPO: Record<string, string> = { mesa: 'Mesa', mostrador: 'Mostrador', llevar: 'Para llevar', delivery: 'Delivery' };

export interface Resumen {
  ingresos: string; pedidos: number; ticketPromedio: string; costo: string; costoAlimentosPct: string | null; merma: string; minutosPreparacion: string | null; utilidadBruta: string;
}

/**
 * Estadísticas del negocio. Los indicadores por día se calculan desde las ventas cobradas, el kardex y los tiempos de cocina, y se guardan en
 * kpi_daily (trabajo nocturno y a pedido). Los ingresos son los cobros no anulados; el costo es lo que salió del inventario por consumo.
 */
@Injectable()
export class EstadisticasService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Estadisticas');
  private reloj?: NodeJS.Timeout;
  constructor(@Inject(TenantDb) private readonly db: TenantDb, @Inject(BD) private readonly bd: Bd, @Inject(RecetasService) private readonly recetas: RecetasService) {}

  /** Trabajo nocturno: cada hora revisa si ya pasaron las 02:00 en La Paz y, una vez al día, recalcula la última semana de cada sucursal. */
  onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    let ultimoDia = '';
    this.reloj = setInterval(() => {
      void (async () => {
        const ahora = new Date(Date.now() - 4 * 3_600_000); const dia = ahora.toISOString().slice(0, 10);
        if (ahora.getUTCHours() < 2 || dia === ultimoDia) return;
        ultimoDia = dia;
        try {
          const rs = (await this.bd.execute(sql`SELECT id FROM restaurants WHERE status = 'activo'`)).rows as { id: string }[];
          for (const r of rs) await this.db.run({ restaurantId: r.id, restaurantIds: [] }, (tx) => this.calcular(tx, { restaurantId: r.id, restaurantIds: [] }, sumarDias(dia, -7), sumarDias(dia, -1)));
          this.log.log(`Indicadores diarios al día para ${rs.length} sucursal(es).`);
        } catch (e) { this.log.error(`No se pudieron calcular los indicadores: ${(e as Error).message}`); ultimoDia = ''; }
      })();
    }, 3_600_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  private async tz(tx: Bd, rid: string) { return ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${rid}`)).rows[0] as { timezone: string }).timezone; }

  private rango(desde: string, hasta: string) {
    if (hasta < desde) throw new BadRequestException('«Hasta» no puede ser anterior a «desde».');
    if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > MAX_DIAS) throw new BadRequestException(`El rango máximo es de ${MAX_DIAS} días.`);
  }

  /** Recalcula y guarda los indicadores de cada día del rango (también los días sin ventas, con ceros). */
  async calcular(tx: Bd, t: Tenant, desde: string, hasta: string): Promise<void> {
    const tz = await this.tz(tx, t.restaurantId); const rid = t.restaurantId;
    await tx.execute(sql`
      WITH dias AS (SELECT d::date AS dia FROM generate_series(${desde}::date, ${hasta}::date, interval '1 day') d),
      ventas AS (SELECT (paid_at AT TIME ZONE ${tz})::date AS dia, SUM(amount) AS ingresos, count(DISTINCT order_id)::int AS pedidos FROM sales_payments
        WHERE restaurant_id = ${rid} AND voided_at IS NULL AND (paid_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1),
      consumo AS (SELECT (created_at AT TIME ZONE ${tz})::date AS dia, SUM(-qty * COALESCE(unit_cost, 0)) AS costo FROM stock_movements
        WHERE restaurant_id = ${rid} AND kind = 'consumo' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1),
      mermas AS (SELECT (created_at AT TIME ZONE ${tz})::date AS dia, SUM(-qty * COALESCE(unit_cost, 0)) AS merma FROM stock_movements
        WHERE restaurant_id = ${rid} AND kind = 'merma' AND (created_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1),
      cocina AS (SELECT (ready_at AT TIME ZONE ${tz})::date AS dia, AVG(extract(epoch FROM (ready_at - sent_at)) / 60) AS minutos FROM order_items
        WHERE restaurant_id = ${rid} AND voided_at IS NULL AND ready_at IS NOT NULL AND sent_at IS NOT NULL AND (ready_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1)
      INSERT INTO kpi_daily (restaurant_id, day, revenue, costs, covers, orders_n, avg_ticket, avg_prep_minutes, food_cost_pct, waste_value, calculated_at)
      SELECT ${rid}, d.dia, COALESCE(v.ingresos, 0), COALESCE(c.costo, 0), COALESCE(v.pedidos, 0), COALESCE(v.pedidos, 0),
        CASE WHEN COALESCE(v.pedidos, 0) > 0 THEN round(v.ingresos / v.pedidos, 2) ELSE 0 END, round(k.minutos::numeric, 2),
        CASE WHEN COALESCE(v.ingresos, 0) > 0 THEN round(COALESCE(c.costo, 0) / v.ingresos * 100, 2) END, COALESCE(m.merma, 0), now()
      FROM dias d LEFT JOIN ventas v ON v.dia = d.dia LEFT JOIN consumo c ON c.dia = d.dia LEFT JOIN mermas m ON m.dia = d.dia LEFT JOIN cocina k ON k.dia = d.dia
      ON CONFLICT (restaurant_id, day) DO UPDATE SET revenue = EXCLUDED.revenue, costs = EXCLUDED.costs, covers = EXCLUDED.covers, orders_n = EXCLUDED.orders_n, avg_ticket = EXCLUDED.avg_ticket,
        avg_prep_minutes = EXCLUDED.avg_prep_minutes, food_cost_pct = EXCLUDED.food_cost_pct, waste_value = EXCLUDED.waste_value, calculated_at = now()`);
  }

  private async sumar(tx: Bd, rid: string, desde: string, hasta: string): Promise<Resumen> {
    const r = (await tx.execute(sql`SELECT COALESCE(SUM(revenue), 0)::numeric(14,2)::text AS ingresos, COALESCE(SUM(orders_n), 0)::int AS pedidos, COALESCE(SUM(costs), 0)::numeric(14,2)::text AS costo, COALESCE(SUM(waste_value), 0)::numeric(14,2)::text AS merma,
        round((SUM(avg_prep_minutes * orders_n) / NULLIF(SUM(orders_n) FILTER (WHERE avg_prep_minutes IS NOT NULL), 0))::numeric, 1)::text AS prep
      FROM kpi_daily WHERE restaurant_id = ${rid} AND day BETWEEN ${desde}::date AND ${hasta}::date`)).rows[0] as { ingresos: string; pedidos: number; costo: string; merma: string; prep: string | null };
    const ing = new Decimal(r.ingresos);
    return { ingresos: r.ingresos, pedidos: r.pedidos, ticketPromedio: r.pedidos > 0 ? r2(ing.div(r.pedidos)) : '0.00', costo: r.costo, costoAlimentosPct: ing.gt(0) ? r2(new Decimal(r.costo).div(ing).mul(100)) : null, merma: r.merma, minutosPreparacion: r.prep, utilidadBruta: r2(ing.minus(r.costo)) };
  }

  /** Totales del período, comparados con el período anterior de la misma duración, y la serie diaria. */
  resumen(t: Tenant, desde: string, hasta: string) {
    this.rango(desde, hasta);
    return this.db.run(t, async (tx) => {
      const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
      const antD = sumarDias(desde, -dias); const antH = sumarDias(desde, -1);
      await this.calcular(tx, t, antD, hasta);
      const actual = await this.sumar(tx, t.restaurantId, desde, hasta); const previo = await this.sumar(tx, t.restaurantId, antD, antH);
      const serie = (await tx.execute(sql`SELECT day::text AS fecha, revenue::numeric(14,2)::text AS ingresos, orders_n AS pedidos, costs::numeric(14,2)::text AS costo FROM kpi_daily WHERE restaurant_id = ${t.restaurantId} AND day BETWEEN ${desde}::date AND ${hasta}::date ORDER BY day`)).rows as { fecha: string; ingresos: string; pedidos: number; costo: string }[];
      const var_ = (a: string | number, p: string | number) => (Number(p) > 0 ? r2(((Number(a) - Number(p)) / Number(p)) * 100) : null);
      return { desde, hasta, dias, actual, anterior: previo, variacion: { ingresosPct: var_(actual.ingresos, previo.ingresos), pedidosPct: var_(actual.pedidos, previo.pedidos), ticketPct: var_(actual.ticketPromedio, previo.ticketPromedio) }, serie };
    });
  }

  /** Ventas agrupadas por hora, día de la semana, plato, categoría, mesero, canal o tipo de pedido. */
  ventas(t: Tenant, grupo: Grupo, desde: string, hasta: string) {
    this.rango(desde, hasta);
    return this.db.run(t, async (tx) => {
      const tz = await this.tz(tx, t.restaurantId); const rid = t.restaurantId;
      type Fila = { clave: string; etiqueta: string | null; ventas: string; cantidad: string };
      let filas: Fila[];
      if (grupo === 'hora' || grupo === 'dia_semana') {
        const clave = grupo === 'hora' ? sql`EXTRACT(HOUR FROM paid_at AT TIME ZONE ${tz})::int` : sql`EXTRACT(ISODOW FROM paid_at AT TIME ZONE ${tz})::int`;
        filas = (await tx.execute(sql`SELECT ${clave}::text AS clave, NULL AS etiqueta, SUM(amount)::numeric(14,2)::text AS ventas, count(DISTINCT order_id)::text AS cantidad FROM sales_payments
          WHERE restaurant_id = ${rid} AND voided_at IS NULL AND (paid_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY 1`)).rows as unknown as Fila[];
      } else {
        const col = { plato: sql`m.id::text`, categoria: sql`COALESCE(c.id::text, '-')`, mesero: sql`COALESCE(o.waiter_id::text, '-')`, canal: sql`o.channel::text`, tipo: sql`o.order_type::text` }[grupo];
        const eti = { plato: sql`m.name`, categoria: sql`COALESCE(c.name, 'Sin categoría')`, mesero: sql`COALESCE(s.full_name, 'Sin mesero')`, canal: sql`o.channel::text`, tipo: sql`o.order_type::text` }[grupo];
        filas = (await tx.execute(sql`SELECT ${col} AS clave, ${eti} AS etiqueta, SUM(i.qty * i.unit_price)::numeric(14,2)::text AS ventas, SUM(i.qty)::numeric(14,2)::text AS cantidad
          FROM order_items i JOIN orders o ON o.id = i.order_id JOIN menu_items m ON m.id = i.menu_item_id LEFT JOIN menu_categories c ON c.id = m.category_id LEFT JOIN staff_members s ON s.id = o.waiter_id
          WHERE i.restaurant_id = ${rid} AND i.voided_at IS NULL AND NOT (i.from_qr AND i.status = 'borrador') AND o.status = 'cobrado' AND (o.closed_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date
          GROUP BY ${col}, ${eti}`)).rows as unknown as Fila[];
      }
      const etiqueta = (f: Fila) => (grupo === 'hora' ? `${f.clave.padStart(2, '0')}:00` : grupo === 'dia_semana' ? DIA[Number(f.clave)] : grupo === 'canal' ? (CANAL[f.clave] ?? f.clave) : grupo === 'tipo' ? (TIPO[f.clave] ?? f.clave) : (f.etiqueta ?? f.clave));
      const total = filas.reduce((s, f) => s.plus(f.ventas), new Decimal(0));
      const orden = (a: Fila, b: Fila) => (grupo === 'hora' || grupo === 'dia_semana' ? Number(a.clave) - Number(b.clave) : Number(b.ventas) - Number(a.ventas));
      return { grupo, desde, hasta, total: total.toFixed(2), unidad: grupo === 'hora' || grupo === 'dia_semana' ? 'pedidos' : 'unidades',
        filas: filas.sort(orden).map((f) => ({ clave: f.clave, etiqueta: etiqueta(f), ventas: f.ventas, cantidad: f.cantidad, participacionPct: total.gt(0) ? r2(new Decimal(f.ventas).div(total).mul(100)) : '0.00' })) };
    });
  }

  /** Ingeniería de menú: popularidad contra margen. Estrella, caballo (muy pedido, poco margen), puzzle (buen margen, poco pedido) o perro. */
  menu(t: Tenant, desde: string, hasta: string) {
    this.rango(desde, hasta);
    return this.db.run(t, async (tx) => {
      const tz = await this.tz(tx, t.restaurantId);
      const vend = (await tx.execute(sql`SELECT m.id, m.name, SUM(i.qty)::numeric(14,2)::text AS unidades, SUM(i.qty * i.unit_price)::numeric(14,2)::text AS ventas
        FROM order_items i JOIN orders o ON o.id = i.order_id JOIN menu_items m ON m.id = i.menu_item_id
        WHERE i.restaurant_id = ${t.restaurantId} AND i.voided_at IS NULL AND NOT (i.from_qr AND i.status = 'borrador') AND o.status = 'cobrado' AND (o.closed_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date
        GROUP BY m.id, m.name`)).rows as { id: string; name: string; unidades: string; ventas: string }[];
      if (!vend.length) return { desde, hasta, platos: [], umbralUnidades: '0', margenPromedioPct: null, resumen: { estrella: 0, caballo: 0, puzzle: 0, perro: 0, sin_receta: 0 } };
      const cat = await this.recetas.catalogo(tx, t); const costos = await this.recetas.costos(tx, t);
      const filas = vend.map((v) => {
        const receta = cat.recetaDePlato[v.id]; let cpp: Decimal | null = null;
        try { cpp = receta ? costoPorPorcion(cat, receta, costos) : null; } catch { cpp = null; }
        const u = new Decimal(v.unidades); const precio = u.gt(0) ? new Decimal(v.ventas).div(u) : new Decimal(0);
        const margen = cpp && precio.gt(0) ? precio.minus(cpp).div(precio).mul(100) : null;
        return { platoId: v.id, nombre: v.name, unidades: u, ventas: v.ventas, precioPromedio: precio, costoPorPorcion: cpp, margen };
      });
      const totalUn = filas.reduce((s, f) => s.plus(f.unidades), new Decimal(0));
      const umbral = totalUn.div(filas.length).mul(0.7);
      const conMargen = filas.filter((f) => f.margen !== null);
      const pesoU = conMargen.reduce((s, f) => s.plus(f.unidades), new Decimal(0));
      const margenProm = pesoU.gt(0) ? conMargen.reduce((s, f) => s.plus(f.margen!.mul(f.unidades)), new Decimal(0)).div(pesoU) : null;
      const resumen = { estrella: 0, caballo: 0, puzzle: 0, perro: 0, sin_receta: 0 };
      const platos = filas.map((f) => {
        const popular = f.unidades.gte(umbral);
        const clase = f.margen === null || margenProm === null ? 'sin_receta' : popular ? (f.margen.gte(margenProm) ? 'estrella' : 'caballo') : (f.margen.gte(margenProm) ? 'puzzle' : 'perro');
        resumen[clase as keyof typeof resumen]++;
        return { platoId: f.platoId, nombre: f.nombre, unidades: f.unidades.toFixed(2), ventas: f.ventas, precioPromedio: r2(f.precioPromedio), costoPorPorcion: f.costoPorPorcion ? r2(f.costoPorPorcion) : null, margenPct: f.margen ? r2(f.margen) : null, clase };
      }).sort((a, b) => Number(b.unidades) - Number(a.unidades));
      return { desde, hasta, umbralUnidades: umbral.toFixed(1), margenPromedioPct: margenProm ? r2(margenProm) : null, resumen, platos };
    });
  }

  /** Historia consecutiva de ingresos por día, desde la primera venta hasta ayer (ceros incluidos). */
  private async historia(tx: Bd, t: Tenant, hoy: string) {
    const tz = await this.tz(tx, t.restaurantId);
    const prim = (await tx.execute(sql`SELECT min((paid_at AT TIME ZONE ${tz})::date)::text AS d FROM sales_payments WHERE restaurant_id = ${t.restaurantId} AND voided_at IS NULL`)).rows[0] as { d: string | null };
    const ayer = sumarDias(hoy, -1);
    if (!prim.d || prim.d > ayer) return { serie: [] as { fecha: string; valor: number }[], costoPct: 0 };
    const desde = prim.d < sumarDias(ayer, -83) ? sumarDias(ayer, -83) : prim.d;
    await this.calcular(tx, t, desde, ayer);
    const r = (await tx.execute(sql`SELECT day::text AS fecha, revenue::float8 AS valor, costs::float8 AS costo FROM kpi_daily WHERE restaurant_id = ${t.restaurantId} AND day BETWEEN ${desde}::date AND ${ayer}::date ORDER BY day`)).rows as { fecha: string; valor: number; costo: number }[];
    const ing = r.reduce((s, x) => s + x.valor, 0); const cos = r.reduce((s, x) => s + x.costo, 0);
    return { serie: r.map((x) => ({ fecha: x.fecha, valor: x.valor })), costoPct: ing > 0 ? cos / ing : 0 };
  }

  private async hoyLocal(tx: Bd, t: Tenant) { return ((await tx.execute(sql`SELECT (now() AT TIME ZONE ${await this.tz(tx, t.restaurantId)})::date::text AS d`)).rows[0] as { d: string }).d; }

  /** Proyección de ingresos a 4 semanas con banda de confianza, y compras estimadas (costo de alimentos histórico sobre el ingreso proyectado). */
  proyeccion(t: Tenant, semanas = 4) {
    return this.db.run(t, async (tx) => {
      const hoy = await this.hoyLocal(tx, t); const h = await this.historia(tx, t, hoy);
      const p = proyectar(h.serie, hoy, semanas);
      if (!p.suficiente) return { ...p, desde: hoy };
      return { ...p, desde: hoy, costoAlimentosPct: r2(h.costoPct * 100), comprasEstimadas: r2(p.total.valor * h.costoPct) };
    });
  }

  /** «¿Y si subo 5 %?»: variación de precio y de demanda sobre la proyección. Es aritmética sobre un pronóstico, no una predicción de la reacción de los clientes. */
  escenario(t: Tenant, precioPct: number, demandaPct: number, semanas = 4) {
    return this.db.run(t, async (tx) => {
      const hoy = await this.hoyLocal(tx, t); const h = await this.historia(tx, t, hoy);
      const p = proyectar(h.serie, hoy, semanas);
      if (!p.suficiente) return { suficiente: false as const, motivo: p.motivo, semanasHistoria: p.semanasHistoria, minimoSemanas: p.minimoSemanas };
      const base = { ingresos: p.total.valor, costo: p.total.valor * h.costoPct };
      return { suficiente: true as const, semanas, precioPct, demandaPct, base: { ingresos: r2(base.ingresos), costo: r2(base.costo), utilidadBruta: r2(base.ingresos - base.costo) }, escenario: escenario(base, precioPct, demandaPct),
        nota: 'Cuenta simple sobre la proyección: asume que el costo sigue a la demanda y no al precio. Si subes precios, estima cuánto podría bajar la demanda y compruébalo aquí.' };
    });
  }

  /** Comparación entre las sucursales indicadas (solo las que la persona administra). */
  comparar(ids: string[], desde: string, hasta: string) {
    this.rango(desde, hasta);
    if (!ids.length) return { desde, hasta, sucursales: [] };
    const t: Tenant = { restaurantId: ids[0], restaurantIds: ids };
    return this.db.run(t, async (tx) => {
      const nombres = (await tx.execute(sql`SELECT id, name FROM restaurants WHERE id = ANY(${uuidArray(ids)})`)).rows as { id: string; name: string }[];
      const filas = [];
      for (const n of nombres) {
        await this.calcular(tx, { restaurantId: n.id, restaurantIds: ids }, desde, hasta);
        filas.push({ id: n.id, nombre: n.name, ...(await this.sumar(tx, n.id, desde, hasta)) });
      }
      return { desde, hasta, sucursales: filas.sort((a, b) => Number(b.ingresos) - Number(a.ingresos)) };
    });
  }
}
