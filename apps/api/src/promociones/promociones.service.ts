import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { uuidArray } from '../comun/sql';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { Momento, Promo, Resultado, enHorario, mejorPrecio } from './motor';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida');
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const Dec2 = (max: number) => z.number().positive().max(max).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');

export const NuevaPromocion = z.object({
  nombre: z.string().trim().min(2).max(80),
  descuentoPct: Dec2(100).nullable().optional(), precioFijo: Dec2(100_000).nullable().optional(),
  desde: Fecha, hasta: Fecha,
  diasSemana: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(),
  horaDesde: Hora.nullable().optional(), horaHasta: Hora.nullable().optional(),
  platos: z.array(z.string().uuid()).max(200).default([]),
}).strict()
  .refine((d) => (d.descuentoPct != null) !== (d.precioFijo != null), { message: 'Indica un descuento en % o un precio fijo, no ambos.' })
  .refine((d) => d.hasta >= d.desde, { message: '«Hasta» no puede ser anterior a «desde».' })
  .refine((d) => (d.horaDesde == null) === (d.horaHasta == null), { message: 'Indica la hora de inicio y la de fin, o ninguna.' })
  .refine((d) => d.precioFijo == null || d.platos.length > 0, { message: 'Un precio fijo necesita elegir a qué platos aplica.' })
  .refine((d) => !d.diasSemana || new Set(d.diasSemana).size === d.diasSemana.length, { message: 'Días repetidos.' });
export const Activar = z.object({ activa: z.boolean() }).strict();

interface FilaPromo { id: string; name: string; discount_pct: string | null; fixed_price: string | null; weekdays: number[] | null; ini: string | null; fin: string | null; item_ids: string[] }

/**
 * Promociones del restaurante. El precio con promoción lo decide el servidor al agregar el plato al pedido (nunca el cliente) y se guarda
 * junto al precio de lista, así que ventas, recibos y contabilidad ya reflejan el descuento. Si varias aplican, gana el precio más bajo.
 */
@Injectable()
export class PromocionesService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private async tz(tx: Bd, t: Tenant) { return ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { timezone: string }).timezone; }

  private async momento(tx: Bd, tz: string): Promise<Momento> {
    const r = (await tx.execute(sql`SELECT EXTRACT(ISODOW FROM now() AT TIME ZONE ${tz})::int AS dia, to_char(now() AT TIME ZONE ${tz}, 'HH24:MI') AS hora`)).rows[0] as { dia: number; hora: string };
    return { diaIso: r.dia, hora: r.hora };
  }

  private aPromo(f: FilaPromo): Promo { return { id: f.id, nombre: f.name, descuentoPct: f.discount_pct, precioFijo: f.fixed_price, dias: f.weekdays, horaDesde: f.ini, horaHasta: f.fin, platos: f.item_ids ?? [] }; }

  /** Promociones activas cuya vigencia (fechas) incluye este instante. El horario lo evalúa el motor. */
  async vigentes(tx: Bd, t: Tenant): Promise<{ promos: Promo[]; momento: Momento }> {
    const tz = await this.tz(tx, t);
    const r = (await tx.execute(sql`SELECT id, name, discount_pct::text, fixed_price::text, weekdays, to_char(start_time, 'HH24:MI') AS ini, to_char(end_time, 'HH24:MI') AS fin, item_ids
      FROM promotions WHERE restaurant_id = ${t.restaurantId} AND active AND now() BETWEEN valid_from AND valid_to ORDER BY created_at, id`)).rows as unknown as FilaPromo[];
    return { promos: r.map((f) => this.aPromo(f)), momento: await this.momento(tx, tz) };
  }

  /** Precio que pagará el cliente por cada plato en este momento, con la promoción que lo explica. */
  async precios(tx: Bd, t: Tenant, platos: { id: string; precio: string }[]): Promise<Map<string, Resultado>> {
    const { promos, momento } = await this.vigentes(tx, t);
    return new Map(platos.map((p) => [p.id, mejorPrecio(p.precio, p.id, promos, momento)]));
  }

  /* ---------------- administración ---------------- */

  private async validarPlatos(tx: Bd, t: Tenant, ids: string[]) {
    if (!ids.length) return;
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Un plato aparece repetido.');
    const ok = (await tx.execute(sql`SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = ${t.restaurantId} AND id = ANY(${uuidArray(ids)})`)).rows[0] as { n: number };
    if (ok.n !== ids.length) throw new BadRequestException('Alguno de los platos no existe en esta sucursal.');
  }

  private alcance(d: z.infer<typeof NuevaPromocion>): string { return d.horaDesde ? 'hora' : d.diasSemana ? 'semana' : d.desde === d.hasta ? 'dia' : 'rango'; }

  lista(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const tz = await this.tz(tx, t); const m = await this.momento(tx, tz);
      const r = await tx.execute(sql`SELECT p.id, p.name, p.discount_pct::text AS discount_pct, p.fixed_price::text AS fixed_price, p.weekdays, to_char(p.start_time, 'HH24:MI') AS ini, to_char(p.end_time, 'HH24:MI') AS fin, p.item_ids, p.active, p.scope,
          to_char(p.valid_from AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS desde, to_char(p.valid_to AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS hasta,
          (p.valid_from > now()) AS programada, (p.valid_to < now()) AS vencida, (now() BETWEEN p.valid_from AND p.valid_to) AS en_fechas,
          COALESCE((SELECT array_agg(i.name ORDER BY i.name) FROM menu_items i WHERE i.id = ANY(p.item_ids)), '{}') AS nombres
        FROM promotions p WHERE p.restaurant_id = ${t.restaurantId} ORDER BY p.active DESC, p.valid_to DESC, p.name`);
      return (r.rows as unknown as (FilaPromo & { active: boolean; scope: string; desde: string; hasta: string; programada: boolean; vencida: boolean; en_fechas: boolean; nombres: string[] })[]).map((f) => {
        const vigente = f.active && f.en_fechas && enHorario(this.aPromo(f), m);
        return { id: f.id, nombre: f.name, alcance: f.scope, descuentoPct: f.discount_pct, precioFijo: f.fixed_price, desde: f.desde, hasta: f.hasta, diasSemana: f.weekdays, horaDesde: f.ini, horaHasta: f.fin, platos: f.item_ids, platosNombres: f.nombres, activa: f.active,
          estado: !f.active ? 'inactiva' : f.vencida ? 'vencida' : f.programada ? 'programada' : vigente ? 'vigente' : 'fuera_de_horario', vigenteAhora: vigente };
      });
    });
  }

  private async escribir(tx: Bd, t: Tenant, id: string | null, d: z.infer<typeof NuevaPromocion>) {
    await this.validarPlatos(tx, t, d.platos);
    const tz = await this.tz(tx, t);
    const dias = d.diasSemana ? `{${d.diasSemana.join(',')}}` : null;
    const comunes = sql`${d.nombre}, ${this.alcance(d)}, ${d.descuentoPct ?? null}::numeric, ${d.precioFijo ?? null}::numeric, ((${d.desde}::date)::timestamp AT TIME ZONE ${tz}), ((((${d.hasta}::date + 1))::timestamp AT TIME ZONE ${tz}) - interval '1 second'), ${dias}::smallint[], ${d.horaDesde ?? null}::time, ${d.horaHasta ?? null}::time, ${uuidArray(d.platos)}`;
    if (id === null) return ((await tx.execute(sql`INSERT INTO promotions (restaurant_id, name, scope, discount_pct, fixed_price, valid_from, valid_to, weekdays, start_time, end_time, item_ids) VALUES (${t.restaurantId}, ${comunes}) RETURNING id`)).rows[0] as { id: string }).id;
    const r = await tx.execute(sql`UPDATE promotions SET name = ${d.nombre}, scope = ${this.alcance(d)}, discount_pct = ${d.descuentoPct ?? null}::numeric, fixed_price = ${d.precioFijo ?? null}::numeric,
      valid_from = ((${d.desde}::date)::timestamp AT TIME ZONE ${tz}), valid_to = ((((${d.hasta}::date + 1))::timestamp AT TIME ZONE ${tz}) - interval '1 second'), weekdays = ${dias}::smallint[],
      start_time = ${d.horaDesde ?? null}::time, end_time = ${d.horaHasta ?? null}::time, item_ids = ${uuidArray(d.platos)} WHERE id = ${id} AND restaurant_id = ${t.restaurantId} RETURNING id`);
    if (!r.rows.length) throw new NotFoundException('Promoción no encontrada.');
    return id;
  }

  crear(t: Tenant, por: string, d: z.infer<typeof NuevaPromocion>) {
    return this.db.run(t, async (tx) => { const id = await this.escribir(tx, t, null, d); await auditar(tx, t.restaurantId, por, 'promociones.creada', 'promotion', id, d); return { id }; });
  }
  cambiar(t: Tenant, por: string, id: string, d: z.infer<typeof NuevaPromocion>) {
    return this.db.run(t, async (tx) => { await this.escribir(tx, t, id, d); await auditar(tx, t.restaurantId, por, 'promociones.cambiada', 'promotion', id, d); return { ok: true }; });
  }
  activar(t: Tenant, por: string, id: string, d: z.infer<typeof Activar>) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`UPDATE promotions SET active = ${d.activa} WHERE id = ${id} AND restaurant_id = ${t.restaurantId} RETURNING id`);
      if (!r.rows.length) throw new NotFoundException('Promoción no encontrada.');
      await auditar(tx, t.restaurantId, por, d.activa ? 'promociones.activada' : 'promociones.desactivada', 'promotion', id);
      return { ok: true };
    });
  }
  /** Una promoción con ventas no se borra (queda el historial): se desactiva. Sin ventas se borra. */
  borrar(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const uso = (await tx.execute(sql`SELECT count(*)::int AS n FROM order_items WHERE promotion_id = ${id}`)).rows[0] as { n: number };
      if (uso.n > 0) throw new BadRequestException('Esta promoción ya tiene ventas: desactívala para conservar el historial.');
      const r = await tx.execute(sql`DELETE FROM promotions WHERE id = ${id} AND restaurant_id = ${t.restaurantId} RETURNING id`);
      if (!r.rows.length) throw new NotFoundException('Promoción no encontrada.');
      await auditar(tx, t.restaurantId, por, 'promociones.borrada', 'promotion', id);
      return { ok: true };
    });
  }

  /** Efecto de cada promoción en el período: platos vendidos con ella y cuánto se dejó de cobrar respecto al precio de carta. */
  uso(t: Tenant, desde: string, hasta: string) {
    return this.db.run(t, async (tx) => {
      const tz = await this.tz(tx, t);
      const r = await tx.execute(sql`SELECT p.id, p.name, COALESCE(SUM(i.qty), 0)::text AS unidades, COALESCE(SUM(i.qty * i.unit_price), 0)::numeric(14,2)::text AS vendido,
          COALESCE(SUM(i.qty * (i.list_price - i.unit_price)), 0)::numeric(14,2)::text AS descuento
        FROM promotions p LEFT JOIN order_items i ON i.promotion_id = p.id AND i.voided_at IS NULL AND NOT (i.from_qr AND i.status = 'borrador')
          AND EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id AND o.status = 'cobrado' AND (o.closed_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date)
        WHERE p.restaurant_id = ${t.restaurantId} GROUP BY p.id, p.name ORDER BY SUM(i.qty * (i.list_price - i.unit_price)) DESC NULLS LAST, p.name`);
      const filas = (r.rows as { id: string; name: string; unidades: string; vendido: string; descuento: string }[]).map((x) => ({ id: x.id, nombre: x.name, unidades: x.unidades, vendido: x.vendido, descuento: x.descuento }));
      return { desde, hasta, promociones: filas, totalDescuento: filas.reduce((s, f) => s + Number(f.descuento), 0).toFixed(2) };
    });
  }
}
