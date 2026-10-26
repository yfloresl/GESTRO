import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { uuidArray } from '../comun/sql';
import { ComprasService } from '../compras/compras.service';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { ConsumoService } from '../recetas/consumo.service';
import { CicloDeRecetas, UnidadIncompatible, costoPorPorcion, faltantes, r2, r3, requerimientos } from '../recetas/motor';
import { RecetasService } from '../recetas/recetas.service';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida');
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const Monto = z.number().positive().max(100_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');

export const NuevoEvento = z.object({
  nombre: z.string().trim().min(2).max(120), tipo: z.enum(['evento', 'catering', 'buffet', 'privado']),
  cliente: z.string().trim().max(120).nullable().optional(), telefono: z.string().trim().max(30).nullable().optional(),
  invitados: z.number().int().min(1).max(5000), fecha: Fecha, horaInicio: Hora, horaFin: Hora,
  precio: Monto.nullable().optional(), notas: z.string().trim().max(500).nullable().optional(),
}).strict();
export const MenuDelEvento = z.object({ platos: z.array(z.object({ platoId: z.string().uuid(), porciones: z.number().int().min(1).max(20000) }).strict()).max(100) }).strict();
export const CobroDeEvento = z.object({ monto: Monto, via: z.enum(['caja', 'bancos']).default('caja') }).strict();
export const CierreDeEvento = z.object({ diasCredito: z.number().int().min(0).max(365).default(15) }).strict();
export const Cancelacion = z.object({ devolver: z.boolean().default(false), motivo: z.string().trim().min(3).max(160) }).strict();
export const Accion = z.object({ accion: z.enum(['confirmar', 'iniciar']) }).strict();

type Estado = 'cotizado' | 'confirmado' | 'en_curso' | 'cerrado' | 'cancelado';
interface Fila { id: string; name: string; kind: string; client_name: string | null; client_phone: string | null; guests: number; status: Estado; price_total: string | null; notes: string | null; consumed_at: Date | null;
  fecha: string; hora_ini: string; hora_fin: string; pagado: string }

/**
 * Eventos y catering. Cotización con el costo real de las recetas, anticipos que quedan como dinero del cliente (pasivo) hasta que
 * el evento se realiza, salida de insumos al iniciarlo (una sola vez) y reconocimiento del ingreso al cerrarlo.
 */
@Injectable()
export class CateringService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(RecetasService) private readonly recetas: RecetasService,
    @Inject(ConsumoService) private readonly consumo: ConsumoService,
    @Inject(ContabilidadService) private readonly conta: ContabilidadService,
    @Inject(ComprasService) private readonly compras: ComprasService,
  ) {}

  private async tz(tx: Bd, t: Tenant): Promise<string> { return ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { timezone: string }).timezone; }

  private async filas(tx: Bd, t: Tenant, where: ReturnType<typeof sql>) {
    const tz = await this.tz(tx, t);
    return (await tx.execute(sql`SELECT e.id, e.name, e.kind, e.client_name, e.client_phone, e.guests, e.status, e.price_total::text AS price_total, e.notes, e.consumed_at,
        to_char(e.starts_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS fecha, to_char(e.starts_at AT TIME ZONE ${tz}, 'HH24:MI') AS hora_ini, to_char(e.ends_at AT TIME ZONE ${tz}, 'HH24:MI') AS hora_fin,
        COALESCE((SELECT SUM(p.amount) FROM event_payments p WHERE p.event_id = e.id AND p.voided_at IS NULL), 0)::numeric(12,2)::text AS pagado
      FROM events e WHERE e.restaurant_id = ${t.restaurantId} AND ${where} ORDER BY e.starts_at DESC LIMIT 300`)).rows as unknown as Fila[];
  }

  private vista(f: Fila) {
    const total = f.price_total;
    return { id: f.id, nombre: f.name, tipo: f.kind, cliente: f.client_name, telefono: f.client_phone, invitados: f.guests, estado: f.status, precio: total, notas: f.notes,
      fecha: f.fecha, horaInicio: f.hora_ini, horaFin: f.hora_fin, pagado: f.pagado, saldo: total === null ? null : new Decimal(total).minus(f.pagado).toFixed(2), insumosDescontados: !!f.consumed_at };
  }

  lista(t: Tenant, q: { estado?: string; desde?: string; hasta?: string }) {
    return this.db.run(t, async (tx) => (await this.filas(tx, t, sql`(${q.estado ?? null}::text IS NULL OR e.status = ${q.estado ?? null}) AND (${q.desde ?? null}::date IS NULL OR e.starts_at >= ${q.desde ?? null}::date)
      AND (${q.hasta ?? null}::date IS NULL OR e.starts_at < (${q.hasta ?? null}::date + 1))`)).map((f) => this.vista(f)));
  }

  private async cargar(tx: Bd, t: Tenant, id: string, bloquear = false): Promise<Fila> {
    if (bloquear) await tx.execute(sql`SELECT 1 FROM events WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`);
    const [f] = await this.filas(tx, t, sql`e.id = ${id}`);
    if (!f) throw new NotFoundException('Evento no encontrado.');
    return f;
  }

  /** Cotización: venta a precio de carta, costo de las recetas, margen del precio pactado e insumos que faltan contra el stock. */
  private async cotizar(tx: Bd, t: Tenant, f: Fila) {
    const menu = (await tx.execute(sql`SELECT m.menu_item_id AS plato_id, i.name, i.price::text AS precio, m.portions FROM event_menu m JOIN menu_items i ON i.id = m.menu_item_id WHERE m.event_id = ${f.id} ORDER BY i.name`)).rows as { plato_id: string; name: string; precio: string; portions: number }[];
    const cat = await this.recetas.catalogo(tx, t); const costos = await this.recetas.costos(tx, t);
    let venta = new Decimal(0); let costo = new Decimal(0);
    const platos = menu.map((m) => {
      const receta = cat.recetaDePlato[m.plato_id]; let cpp: Decimal | null = null;
      try { cpp = receta ? costoPorPorcion(cat, receta, costos) : null; } catch { cpp = null; }
      venta = venta.plus(new Decimal(m.precio).mul(m.portions)); if (cpp) costo = costo.plus(cpp.mul(m.portions));
      return { platoId: m.plato_id, nombre: m.name, porciones: m.portions, precioCarta: m.precio, tieneReceta: !!receta, costoPorPorcion: cpp ? r2(cpp) : null, costoTotal: cpp ? r2(cpp.mul(m.portions)) : null };
    });
    let insumos: { insumoId: string; insumo: string; unidad: string; requerido: string; stock: string; faltante: string; alcanza: boolean }[] = [];
    try {
      const req = requerimientos(menu.map((m) => ({ platoId: m.plato_id, porciones: m.portions })), cat);
      const st = (await tx.execute(sql`SELECT ingredient_id, SUM(qty)::text AS qty FROM stock_levels WHERE restaurant_id = ${t.restaurantId} GROUP BY ingredient_id`)).rows as { ingredient_id: string; qty: string }[];
      const total = Object.fromEntries(st.map((s) => [s.ingredient_id, s.qty]));
      const falta = faltantes(req.requerido, total);
      insumos = [...req.requerido].map(([id, q]) => ({ insumoId: id, insumo: cat.insumos[id]?.nombre ?? '', unidad: cat.insumos[id]?.unidad ?? '', requerido: r3(q), stock: r3(new Decimal(total[id] ?? 0)), faltante: r3(falta.get(id) ?? new Decimal(0)), alcanza: !falta.has(id) })).sort((a, b) => a.insumo.localeCompare(b.insumo));
    } catch (e) { if (!(e instanceof CicloDeRecetas || e instanceof UnidadIncompatible)) throw e; }
    const precio = f.price_total !== null ? new Decimal(f.price_total) : null; const base = precio ?? venta;
    return {
      platos, ventaACarta: r2(venta), costo: r2(costo), precioPactado: precio ? r2(precio) : null,
      margenPct: base.gt(0) ? base.minus(costo).div(base).mul(100).toFixed(2) : null, utilidad: r2(base.minus(costo)),
      porInvitado: f.guests > 0 && base.gt(0) ? r2(base.div(f.guests)) : null, sinReceta: platos.filter((p) => !p.tieneReceta).map((p) => p.nombre), insumos, hayFaltantes: insumos.some((i) => !i.alcanza),
    };
  }

  detalle(t: Tenant, id: string) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id);
      const pagos = (await tx.execute(sql`SELECT p.id, p.amount::text AS monto, p.kind, p.via, p.created_at, p.voided_at FROM event_payments p WHERE p.event_id = ${id} ORDER BY p.created_at`)).rows as { id: string; monto: string; kind: string; via: string; created_at: Date; voided_at: Date | null }[];
      return { ...this.vista(f), cotizacion: await this.cotizar(tx, t, f), pagos: pagos.map((p) => ({ id: p.id, monto: p.monto, tipo: p.kind, via: p.via, fecha: new Date(p.created_at).toISOString(), anulado: !!p.voided_at })) };
    });
  }

  private async rango(tx: Bd, tz: string, fecha: string, ini: string, fin: string) {
    if (fin <= ini) throw new BadRequestException('La hora de fin debe ser posterior a la de inicio.');
    return (await tx.execute(sql`SELECT ((${fecha}::date + ${ini}::time)::timestamp AT TIME ZONE ${tz})::text AS ini, ((${fecha}::date + ${fin}::time)::timestamp AT TIME ZONE ${tz})::text AS fin`)).rows[0] as { ini: string; fin: string };
  }

  crear(t: Tenant, por: string, d: z.infer<typeof NuevoEvento>) {
    return this.db.run(t, async (tx) => {
      const r = await this.rango(tx, await this.tz(tx, t), d.fecha, d.horaInicio, d.horaFin);
      const e = (await tx.execute(sql`INSERT INTO events (restaurant_id, name, kind, client_name, client_phone, guests, starts_at, ends_at, price_total, notes, created_by)
        VALUES (${t.restaurantId}, ${d.nombre}, ${d.tipo}, ${d.cliente ?? null}, ${d.telefono ?? null}, ${d.invitados}, ${r.ini}::timestamptz, ${r.fin}::timestamptz, ${d.precio ?? null}::numeric, ${d.notas ?? null}, ${por}::uuid) RETURNING id`)).rows[0] as { id: string };
      await auditar(tx, t.restaurantId, por, 'eventos.creado', 'event', e.id, { nombre: d.nombre, fecha: d.fecha, invitados: d.invitados });
      return { id: e.id };
    });
  }

  private editable(f: Fila) { if (!['cotizado', 'confirmado'].includes(f.status)) throw new ConflictException(`Un evento ${f.status.replace('_', ' ')} ya no se puede modificar.`); }

  cambiar(t: Tenant, por: string, id: string, d: z.infer<typeof NuevoEvento>) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id, true); this.editable(f);
      if (d.precio !== undefined && d.precio !== null && new Decimal(d.precio).lt(f.pagado)) throw new BadRequestException(`El precio no puede ser menor a lo ya cobrado (Bs ${f.pagado}).`);
      const r = await this.rango(tx, await this.tz(tx, t), d.fecha, d.horaInicio, d.horaFin);
      await tx.execute(sql`UPDATE events SET name = ${d.nombre}, kind = ${d.tipo}, client_name = ${d.cliente ?? null}, client_phone = ${d.telefono ?? null}, guests = ${d.invitados}, starts_at = ${r.ini}::timestamptz, ends_at = ${r.fin}::timestamptz, price_total = ${d.precio ?? null}::numeric, notes = ${d.notas ?? null} WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'eventos.cambiado', 'event', id, d);
      return { ok: true };
    });
  }

  menu(t: Tenant, por: string, id: string, d: z.infer<typeof MenuDelEvento>) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id, true); this.editable(f);
      const ids = d.platos.map((p) => p.platoId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('Un plato solo puede aparecer una vez en el menú del evento.');
      if (ids.length) {
        const ok = (await tx.execute(sql`SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = ${t.restaurantId} AND id = ANY(${uuidArray(ids)})`)).rows[0] as { n: number };
        if (ok.n !== ids.length) throw new BadRequestException('Alguno de los platos no existe en esta sucursal.');
      }
      await tx.execute(sql`DELETE FROM event_menu WHERE event_id = ${id}`);
      for (const p of d.platos) await tx.execute(sql`INSERT INTO event_menu (restaurant_id, event_id, menu_item_id, portions) VALUES (${t.restaurantId}, ${id}, ${p.platoId}, ${p.porciones})`);
      await auditar(tx, t.restaurantId, por, 'eventos.menu', 'event', id, { platos: d.platos.length });
      return { ok: true };
    });
  }

  /** confirmar: cotizado → confirmado (exige precio). iniciar: confirmado → en curso, saca del inventario los insumos del menú (una vez). */
  cambiarEstado(t: Tenant, por: string, id: string, d: z.infer<typeof Accion>) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id, true);
      if (d.accion === 'confirmar') {
        if (f.status !== 'cotizado') throw new ConflictException('Solo se confirma un evento cotizado.');
        if (f.price_total === null || !new Decimal(f.price_total).gt(0)) throw new BadRequestException('Fija el precio del evento antes de confirmarlo.');
        await tx.execute(sql`UPDATE events SET status = 'confirmado' WHERE id = ${id}`);
        await auditar(tx, t.restaurantId, por, 'eventos.confirmado', 'event', id);
        return { ok: true, estado: 'confirmado' as Estado };
      }
      if (f.status !== 'confirmado') throw new ConflictException('Solo se inicia un evento confirmado.');
      const platos = (await tx.execute(sql`SELECT menu_item_id AS "platoId", portions AS porciones FROM event_menu WHERE event_id = ${id}`)).rows as { platoId: string; porciones: number }[];
      const r = f.consumed_at ? { insumos: 0 } : await this.consumo.descontarEvento(tx, t, por, id, platos);
      await tx.execute(sql`UPDATE events SET status = 'en_curso', consumed_at = COALESCE(consumed_at, now()) WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'eventos.iniciado', 'event', id, { insumos: r.insumos });
      return { ok: true, estado: 'en_curso' as Estado, insumosDescontados: r.insumos };
    });
  }

  /** Cobro (anticipo antes del evento, saldo durante o al final). Nunca supera el precio pactado. */
  cobrar(t: Tenant, por: string, id: string, d: z.infer<typeof CobroDeEvento>) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id, true);
      if (!['cotizado', 'confirmado', 'en_curso'].includes(f.status)) throw new ConflictException(`Un evento ${f.status.replace('_', ' ')} no recibe cobros.`);
      if (f.price_total === null) throw new BadRequestException('Fija el precio del evento antes de cobrar.');
      const saldo = new Decimal(f.price_total).minus(f.pagado);
      if (new Decimal(d.monto).gt(saldo)) throw new BadRequestException(`El cobro supera el saldo del evento (Bs ${saldo.toFixed(2)}).`);
      const pago = (await tx.execute(sql`INSERT INTO event_payments (restaurant_id, event_id, amount, kind, via, created_by) VALUES (${t.restaurantId}, ${id}, ${d.monto.toFixed(2)}::numeric, ${f.status === 'en_curso' ? 'saldo' : 'anticipo'}, ${d.via}, ${por}::uuid) RETURNING id`)).rows[0] as { id: string };
      await tx.execute(sql`UPDATE events SET deposit = (SELECT COALESCE(SUM(amount), 0) FROM event_payments WHERE event_id = ${id} AND voided_at IS NULL) WHERE id = ${id}`);
      await this.conta.pagoDeEvento(tx, t, por, pago.id, d.monto.toFixed(2), d.via);
      await auditar(tx, t.restaurantId, por, 'eventos.cobro', 'event_payment', pago.id, { evento: id, monto: d.monto, via: d.via });
      return { id: pago.id, saldo: saldo.minus(d.monto).toFixed(2) };
    });
  }

  /** Cierre: el ingreso se reconoce (ventas) y, si falta cobrar, nace la cuenta por cobrar del cliente. */
  cerrar(t: Tenant, por: string, id: string, d: z.infer<typeof CierreDeEvento>) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id, true);
      if (f.status !== 'en_curso') throw new ConflictException('Solo se cierra un evento en curso.');
      if (f.price_total === null) throw new BadRequestException('El evento no tiene precio.');
      const saldo = new Decimal(f.price_total).minus(f.pagado);
      await tx.execute(sql`UPDATE events SET status = 'cerrado', closed_at = now() WHERE id = ${id}`);
      await this.conta.cierreDeEvento(tx, t, por, id, f.price_total, f.pagado);
      if (saldo.gt(0)) {
        await tx.execute(sql`INSERT INTO payables_receivables (restaurant_id, direction, counterparty, customer_phone, amount, due_on, event_id, document_number)
          VALUES (${t.restaurantId}, 'por_cobrar', ${f.client_name ?? f.name}, ${f.client_phone}, ${saldo.toFixed(2)}::numeric, (now() AT TIME ZONE 'America/La_Paz')::date + ${d.diasCredito}::int, ${id}, ${`Evento: ${f.name}`.slice(0, 80)})`);
      }
      await auditar(tx, t.restaurantId, por, 'eventos.cerrado', 'event', id, { total: f.price_total, cobrado: f.pagado, porCobrar: saldo.toFixed(2) });
      return { ok: true, porCobrar: saldo.toFixed(2) };
    });
  }

  /** Cancela un evento que aún no empezó. Si ya hay cobros, hay que devolverlos (queda anulado cada cobro y su asiento). */
  cancelar(t: Tenant, por: string, id: string, d: z.infer<typeof Cancelacion>) {
    return this.db.run(t, async (tx) => {
      const f = await this.cargar(tx, t, id, true);
      if (!['cotizado', 'confirmado'].includes(f.status)) throw new ConflictException(f.status === 'en_curso' ? 'Un evento en curso ya consumió insumos: ciérralo en vez de cancelarlo.' : `Un evento ${f.status} no se puede cancelar.`);
      if (new Decimal(f.pagado).gt(0) && !d.devolver) throw new ConflictException(`El evento tiene Bs ${f.pagado} cobrados: confirma la devolución al cliente para cancelarlo.`);
      const pagos = (await tx.execute(sql`SELECT id FROM event_payments WHERE event_id = ${id} AND voided_at IS NULL`)).rows as { id: string }[];
      for (const p of pagos) {
        await tx.execute(sql`UPDATE event_payments SET voided_at = now() WHERE id = ${p.id}`);
        await this.conta.pagoDeEventoDevuelto(tx, t, por, p.id, `Evento cancelado: ${d.motivo}`);
      }
      await tx.execute(sql`UPDATE events SET status = 'cancelado', deposit = 0, notes = COALESCE(notes || E'\n', '') || ${`Cancelado: ${d.motivo}`} WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'eventos.cancelado', 'event', id, { motivo: d.motivo, devuelto: f.pagado });
      return { ok: true, devuelto: f.pagado };
    });
  }

  /** Órdenes de compra en borrador (una por proveedor preferido) con lo que falta para el menú del evento. */
  async ordenesDeCompra(t: Tenant, por: string, id: string) {
    const falta = await this.db.run(t, async (tx) => {
      const c = await this.cotizar(tx, t, await this.cargar(tx, t, id));
      return c.insumos.filter((i) => !i.alcanza).map((i) => ({ insumoId: i.insumoId, cantidad: i.faltante }));
    });
    if (!falta.length) throw new BadRequestException('El stock alcanza para este menú: no hace falta comprar nada.');
    return { insumosFaltantes: falta.length, ...(await this.compras.ordenesDeFaltantes(t, por, falta)) };
  }
}
