import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { menuItems, orderItems, orders, restaurants, restaurantTables, staffMembers } from '../database/esquema';
import { EventosGateway, salas } from '../tiempo-real/eventos.gateway';
import { PushService } from '../tiempo-real/push.service';

const TIPOS = ['mesa', 'mostrador', 'llevar', 'delivery'] as const;
export const NuevoPedido = z.object({
  tipo: z.enum(TIPOS),
  mesaId: z.string().uuid().optional(),
  cliente: z.object({
    nombre: z.string().trim().max(120).optional(), telefono: z.string().trim().max(30).optional(),
    direccion: z.string().trim().max(200).optional(), recojo: z.string().datetime({ offset: true }).optional(),
  }).strict().optional(),
  comentario: z.string().trim().max(300).optional(),
}).strict().superRefine((d, ctx) => {
  if (d.tipo === 'mesa' && !d.mesaId) ctx.addIssue({ code: 'custom', path: ['mesaId'], message: 'Un pedido de mesa necesita la mesa.' });
  if (d.tipo === 'delivery' && !(d.cliente?.direccion && d.cliente?.telefono)) ctx.addIssue({ code: 'custom', path: ['cliente'], message: 'Delivery necesita dirección y teléfono.' });
});

export const ItemNuevo = z.object({
  platoId: z.string().uuid(), cantidad: z.number().int().min(1).max(99),
  nota: z.string().trim().max(200).optional(), modificadores: z.array(z.string().trim().min(1).max(40)).max(8).optional(), tiempo: z.number().int().min(1).max(3).optional(),
}).strict();
export const AgregarItems = z.object({ items: z.array(ItemNuevo).min(1).max(30) }).strict();
export const Motivo = z.object({ motivo: z.string().trim().min(3).max(200) }).strict();
export const MoverMesa = z.object({ mesaId: z.string().uuid() }).strict();
export const EstadoCocina = z.object({ estado: z.enum(['en_preparacion', 'listo']) }).strict();

const ABIERTO = ['borrador', 'enviado', 'en_preparacion', 'listo', 'servido'];

export interface PedidoVista {
  id: string; tipo: string; mesaId: string | null; mesa: string | null; ticket: number | null; canal: string; estado: string; cliente: string | null; telefono: string | null; direccion: string | null;
  recojo: string | null; comentario: string | null; subtotal: string; total: string; abierto: string; enviado: string | null; mesero: string | null;
  items: { id: string; platoId: string; nombre: string; cantidad: string; precio: string; nota: string | null; modificadores: string[]; tiempo: number; estado: string; anulado: boolean; motivoAnulacion: string | null; porConfirmar: boolean; desdeQr: boolean; iniciado: string | null; listo: string | null }[];
}

@Injectable()
export class PedidosService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EventosGateway) private readonly eventos: EventosGateway,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /** Pedido con sus ítems, listo para la interfaz. Los totales salen de la base (NUMERIC), nunca de aritmética de punto flotante. */
  async vista(tx: Bd, rid: string, id: string): Promise<PedidoVista> {
    const [o] = await tx.select({ o: orders, mesa: restaurantTables.number, mesero: staffMembers.fullName }).from(orders)
      .leftJoin(restaurantTables, eq(restaurantTables.id, orders.tableId)).leftJoin(staffMembers, eq(staffMembers.id, orders.waiterId))
      .where(and(eq(orders.id, id), eq(orders.restaurantId, rid)));
    if (!o) throw new NotFoundException('Pedido no encontrado.');
    const items = await tx.select({ i: orderItems, nombre: menuItems.name }).from(orderItems).innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId)).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.course), asc(orderItems.sentAt));
    return {
      id: o.o.id, tipo: o.o.orderType, mesaId: o.o.tableId, mesa: o.mesa, ticket: o.o.ticketNumber, canal: o.o.channel, estado: o.o.status, cliente: o.o.customerName, telefono: o.o.customerPhone,
      direccion: o.o.deliveryAddress, recojo: o.o.pickupAt?.toISOString() ?? null, comentario: o.o.customerComment, subtotal: o.o.subtotal, total: o.o.total, abierto: o.o.openedAt.toISOString(),
      enviado: o.o.sentAt?.toISOString() ?? null, mesero: o.mesero,
      items: items.map(({ i, nombre }) => ({
        id: i.id, platoId: i.menuItemId, nombre, cantidad: i.qty, precio: i.unitPrice, nota: i.note, modificadores: (i.modifiers as string[]) ?? [], tiempo: i.course, estado: i.status,
        anulado: !!i.voidedAt, motivoAnulacion: i.voidReason, porConfirmar: i.fromQr && i.status === 'borrador', desdeQr: i.fromQr, iniciado: i.startedAt?.toISOString() ?? null, listo: i.readyAt?.toISOString() ?? null,
      })),
    };
  }

  /** Subtotal y total: suma de los ítems vigentes. Un ítem del QR sin confirmar todavía no se cobra. */
  async recalcular(tx: Bd, id: string) {
    await tx.execute(sql`UPDATE orders o SET subtotal = s.t, total = GREATEST(s.t - o.discount, 0)
      FROM (SELECT COALESCE(SUM(qty * unit_price), 0) AS t FROM order_items WHERE order_id = ${id} AND voided_at IS NULL AND NOT (from_qr AND status = 'borrador')) s WHERE o.id = ${id}`);
  }

  private async abierto(tx: Bd, t: Tenant, id: string) {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.restaurantId, t.restaurantId)));
    if (!o) throw new NotFoundException('Pedido no encontrado.');
    if (!ABIERTO.includes(o.status)) throw new ConflictException('El pedido ya está cerrado.');
    return o;
  }

  /** Número de ticket del día, único por sucursal (zona America/La_Paz), tomado con UPDATE atómico. */
  private async siguienteTicket(tx: Bd, rid: string): Promise<number> {
    const r = await tx.execute(sql`INSERT INTO order_counters (restaurant_id, day, last_number) VALUES (${rid}, (now() AT TIME ZONE 'America/La_Paz')::date, 1)
      ON CONFLICT (restaurant_id, day) DO UPDATE SET last_number = order_counters.last_number + 1 RETURNING last_number`);
    return (r.rows[0] as { last_number: number }).last_number;
  }

  async crear(t: Tenant, userId: string, d: z.infer<typeof NuevoPedido>) {
    return this.db.run(t, async (tx) => {
      if (d.tipo === 'mesa') {
        const [m] = await tx.select({ id: restaurantTables.id, activa: restaurantTables.active }).from(restaurantTables).where(and(eq(restaurantTables.id, d.mesaId!), eq(restaurantTables.restaurantId, t.restaurantId)));
        if (!m || !m.activa) throw new BadRequestException('La mesa no existe o no está activa.');
        // Una mesa tiene un solo pedido abierto: lo del cliente (QR) y lo del mesero se juntan.
        const [ya] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tableId, d.mesaId!), eq(orders.restaurantId, t.restaurantId), inArray(orders.status, ABIERTO)));
        if (ya) return { existente: true, pedido: await this.vista(tx, t.restaurantId, ya.id) };
      }
      const [staff] = await tx.select({ id: staffMembers.id }).from(staffMembers).where(and(eq(staffMembers.userId, userId), eq(staffMembers.restaurantId, t.restaurantId)));
      const ticket = d.tipo === 'mesa' ? null : await this.siguienteTicket(tx, t.restaurantId);
      const [o] = await tx.insert(orders).values({
        restaurantId: t.restaurantId, tableId: d.tipo === 'mesa' ? d.mesaId! : null, waiterId: staff?.id ?? null, channel: d.tipo === 'mesa' ? 'mesero' : 'caja', orderType: d.tipo, ticketNumber: ticket,
        customerName: d.cliente?.nombre ?? null, customerPhone: d.cliente?.telefono ?? null, deliveryAddress: d.cliente?.direccion ?? null, pickupAt: d.cliente?.recojo ? new Date(d.cliente.recojo) : null,
        createdBy: userId, customerComment: d.comentario ?? null, status: 'borrador',
      }).returning({ id: orders.id });
      await auditar(tx, t.restaurantId, userId, 'pedido.creado', 'order', o.id, { tipo: d.tipo, ticket });
      return { existente: false, pedido: await this.vista(tx, t.restaurantId, o.id) };
    });
  }

  /** Agrega ítems con el precio vigente del menú (se guarda como copia: un cambio de precio posterior no altera el pedido). */
  async agregar(t: Tenant, userId: string | null, id: string, d: z.infer<typeof AgregarItems>, desdeQr = false, autoEnviar = false) {
    const r = await this.db.run(t, async (tx) => {
      const o = await this.abierto(tx, t, id);
      if (o.status === 'servido' && desdeQr) throw new ConflictException('Tu pedido anterior ya fue servido. Pide al mesero para uno nuevo.');
      const ids = [...new Set(d.items.map((i) => i.platoId))];
      const platos = await tx.select().from(menuItems).where(and(inArray(menuItems.id, ids), eq(menuItems.restaurantId, t.restaurantId)));
      for (const i of d.items) {
        const p = platos.find((x) => x.id === i.platoId);
        if (!p) throw new BadRequestException('Uno de los platos no existe en esta sucursal.');
        if (!p.available) throw new ConflictException(`«${p.name}» está agotado hoy.`);
      }
      const estado = autoEnviar ? 'enviado' : 'borrador';
      await tx.insert(orderItems).values(d.items.map((i) => ({
        restaurantId: t.restaurantId, orderId: id, menuItemId: i.platoId, qty: String(i.cantidad), unitPrice: platos.find((x) => x.id === i.platoId)!.price,
        note: i.nota ?? null, modifiers: i.modificadores ?? [], course: i.tiempo ?? 1, status: estado, fromQr: desdeQr, sentAt: autoEnviar ? sql`now()` as unknown as Date : null,
      })));
      if (autoEnviar && o.status === 'borrador') await tx.update(orders).set({ status: 'enviado', sentAt: sql`now()` as unknown as Date }).where(eq(orders.id, id));
      else if (autoEnviar && !o.sentAt) await tx.update(orders).set({ sentAt: sql`now()` as unknown as Date }).where(eq(orders.id, id));
      await this.recalcular(tx, id);
      await auditar(tx, t.restaurantId, userId, desdeQr ? 'pedido.items_qr' : 'pedido.items_agregados', 'order', id, { cantidad: d.items.length });
      return this.vista(tx, t.restaurantId, id);
    });
    if (autoEnviar) this.avisarCocina(t.restaurantId, r, 'ticket.nuevo');
    return r;
  }

  /** Quita un ítem que todavía no se envió a cocina. Los ya enviados no se borran: se anulan con motivo. */
  quitar(t: Tenant, userId: string, itemId: string) {
    return this.db.run(t, async (tx) => {
      const [i] = await tx.select().from(orderItems).where(and(eq(orderItems.id, itemId), eq(orderItems.restaurantId, t.restaurantId)));
      if (!i) throw new NotFoundException('Ítem no encontrado.');
      if (i.status !== 'borrador') throw new ConflictException('Ese plato ya se envió a cocina: anúlalo con un motivo.');
      await tx.delete(orderItems).where(eq(orderItems.id, itemId));
      await this.recalcular(tx, i.orderId);
      await auditar(tx, t.restaurantId, userId, 'pedido.item_quitado', 'order_item', itemId);
      return this.vista(tx, t.restaurantId, i.orderId);
    });
  }

  /** Envía a cocina todo lo pendiente (también confirma lo que el cliente pidió por QR). */
  async enviar(t: Tenant, userId: string, id: string) {
    const r = await this.db.run(t, async (tx) => {
      const o = await this.abierto(tx, t, id);
      const enviados = await tx.update(orderItems).set({ status: 'enviado', sentAt: sql`now()` as unknown as Date }).where(and(eq(orderItems.orderId, id), eq(orderItems.status, 'borrador'), isNull(orderItems.voidedAt))).returning({ id: orderItems.id });
      if (!enviados.length) throw new ConflictException('No hay platos nuevos para enviar.');
      await tx.update(orders).set({ status: o.status === 'borrador' || o.status === 'listo' || o.status === 'servido' ? 'enviado' : o.status, sentAt: o.sentAt ?? (sql`now()` as unknown as Date), readyAt: null }).where(eq(orders.id, id));
      await this.recalcular(tx, id);
      await auditar(tx, t.restaurantId, userId, 'pedido.enviado', 'order', id, { platos: enviados.length });
      return this.vista(tx, t.restaurantId, id);
    });
    this.avisarCocina(t.restaurantId, r, 'ticket.nuevo');
    return r;
  }

  /** Anular un plato ya enviado: solo roles con permiso y siempre con motivo; queda quién y cuándo. */
  async anularItem(t: Tenant, userId: string, itemId: string, motivo: string) {
    const r = await this.db.run(t, async (tx) => {
      const [i] = await tx.select().from(orderItems).where(and(eq(orderItems.id, itemId), eq(orderItems.restaurantId, t.restaurantId)));
      if (!i) throw new NotFoundException('Ítem no encontrado.');
      if (i.voidedAt) throw new ConflictException('Ese plato ya está anulado.');
      await this.abierto(tx, t, i.orderId);
      await tx.update(orderItems).set({ voidedAt: sql`now()` as unknown as Date, voidedBy: userId, voidReason: motivo }).where(eq(orderItems.id, itemId));
      await this.recalcular(tx, i.orderId);
      await auditar(tx, t.restaurantId, userId, 'pedido.item_anulado', 'order_item', itemId, { motivo });
      return this.vista(tx, t.restaurantId, i.orderId);
    });
    this.avisarCocina(t.restaurantId, r, 'ticket.actualizado');
    return r;
  }

  moverMesa(t: Tenant, userId: string, id: string, mesaId: string) {
    return this.db.run(t, async (tx) => {
      const o = await this.abierto(tx, t, id);
      if (o.orderType !== 'mesa') throw new BadRequestException('Solo los pedidos de mesa se mueven de mesa.');
      const [m] = await tx.select({ id: restaurantTables.id }).from(restaurantTables).where(and(eq(restaurantTables.id, mesaId), eq(restaurantTables.restaurantId, t.restaurantId), eq(restaurantTables.active, true)));
      if (!m) throw new BadRequestException('La mesa no existe o no está activa.');
      const [ocupada] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tableId, mesaId), eq(orders.restaurantId, t.restaurantId), inArray(orders.status, ABIERTO), ne(orders.id, id)));
      if (ocupada) throw new ConflictException('Esa mesa ya tiene un pedido abierto.');
      await tx.update(orders).set({ tableId: mesaId }).where(eq(orders.id, id));
      await auditar(tx, t.restaurantId, userId, 'pedido.mesa_movida', 'order', id, { mesaId });
      return this.vista(tx, t.restaurantId, id);
    });
  }

  async pedidoDeItem(t: Tenant, itemId: string): Promise<string> {
    const [i] = await this.db.run(t, (tx) => tx.select({ o: orderItems.orderId }).from(orderItems).where(and(eq(orderItems.id, itemId), eq(orderItems.restaurantId, t.restaurantId))));
    if (!i) throw new NotFoundException('Ítem no encontrado.');
    return i.o;
  }

  detalle(t: Tenant, id: string) { return this.db.run(t, (tx) => this.vista(tx, t.restaurantId, id)); }

  /** Lista del día (pantalla 2.6). `abiertos` = en curso; `hoy` = todo lo abierto desde las 00:00 de La Paz. */
  async listar(t: Tenant, filtro: 'abiertos' | 'hoy', tipo?: string) {
    return this.db.run(t, async (tx) => {
      const cond = [eq(orders.restaurantId, t.restaurantId), filtro === 'abiertos' ? inArray(orders.status, ABIERTO) : sql`${orders.openedAt} >= (date_trunc('day', now() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')`, ...(tipo ? [eq(orders.orderType, tipo)] : [])];
      const ids = await tx.select({ id: orders.id }).from(orders).where(and(...cond)).orderBy(desc(orders.openedAt)).limit(100);
      const r: PedidoVista[] = [];
      for (const { id } of ids) r.push(await this.vista(tx, t.restaurantId, id));
      return r;
    });
  }

  /* ---------- Cocina (KDS) ---------- */

  /** Tickets en curso: pedidos con platos enviados y sin servir. El estado del ticket sale de sus platos. */
  async tickets(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const ids = await tx.execute(sql`SELECT DISTINCT o.id, min(i.sent_at) AS desde FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.restaurant_id = ${t.restaurantId} AND o.status IN ('enviado','en_preparacion','listo') AND i.status IN ('enviado','en_preparacion','listo') AND i.voided_at IS NULL GROUP BY o.id ORDER BY desde ASC LIMIT 60`);
      const out = [];
      for (const { id } of ids.rows as { id: string }[]) out.push(this.ticket(await this.vista(tx, t.restaurantId, id)));
      return out;
    });
  }

  /** Solo cuentan para cocina los platos enviados y vigentes; los ya servidos salen del tablero. */
  ticket(p: PedidoVista) {
    const items = p.items.filter((i) => !i.anulado && ['enviado', 'en_preparacion', 'listo'].includes(i.estado));
    const estado = items.length && items.every((i) => i.estado === 'listo') ? 'listo' : items.some((i) => i.estado !== 'enviado') ? 'en_preparacion' : 'nuevo';
    return { id: p.id, tipo: p.tipo, mesa: p.mesa, ticket: p.ticket, mesero: p.mesero, cliente: p.cliente, recojo: p.recojo, comentario: p.comentario, enviado: p.enviado, estado, items };
  }

  /** Mueve todos los platos activos del ticket (o solo los que faltan) al estado indicado. Al quedar todo listo avisa al mesero. */
  async cocina(t: Tenant, userId: string, id: string, estado: 'en_preparacion' | 'listo', soloItem?: string) {
    const r = await this.db.run(t, async (tx) => {
      const o = await this.abierto(tx, t, id);
      const previos = estado === 'listo' ? ['enviado', 'en_preparacion'] : ['enviado'];
      const q = tx.update(orderItems).set({ status: estado, ...(estado === 'en_preparacion' ? { startedAt: sql`now()` as unknown as Date } : { readyAt: sql`now()` as unknown as Date, startedAt: sql`COALESCE(started_at, now())` as unknown as Date }) })
        .where(and(eq(orderItems.orderId, id), inArray(orderItems.status, previos), isNull(orderItems.voidedAt), ...(soloItem ? [eq(orderItems.id, soloItem)] : [])));
      const hechos = await q.returning({ id: orderItems.id });
      if (!hechos.length) throw new ConflictException('Nada que mover: otro compañero ya lo hizo.');
      const pend = await tx.execute(sql`SELECT count(*)::int AS n FROM order_items WHERE order_id = ${id} AND voided_at IS NULL AND status IN ('enviado','en_preparacion')`);
      const todoListo = (pend.rows[0] as { n: number }).n === 0;
      await tx.update(orders).set({ status: todoListo ? 'listo' : 'en_preparacion', readyAt: todoListo ? (sql`now()` as unknown as Date) : null }).where(eq(orders.id, id));
      await auditar(tx, t.restaurantId, userId, `cocina.${estado}`, 'order', id, { platos: hechos.length });
      return { vista: await this.vista(tx, t.restaurantId, id), todoListo, creadoPor: o.createdBy };
    });
    this.avisarCocina(t.restaurantId, r.vista, 'ticket.actualizado');
    if (r.todoListo) this.avisarListo(t.restaurantId, r.vista, r.creadoPor);
    return r.vista;
  }

  private avisarCocina(rid: string, p: PedidoVista, evento: 'ticket.nuevo' | 'ticket.actualizado') {
    this.eventos.emitir(salas.sucursal(rid), evento, this.ticket(p));
    // El cliente de la mesa ve avanzar su pedido (semáforo de espera).
    if (p.mesaId) this.eventos.emitir(salas.mesa(p.mesaId), 'pedido.estado', { id: p.id });
  }

  private avisarListo(rid: string, p: PedidoVista, userId: string | null) {
    const datos = { id: p.id, mesa: p.mesa, ticket: p.ticket, tipo: p.tipo };
    this.eventos.emitir(salas.sucursal(rid), 'pedido.listo', { ...datos, paraMi: false });
    if (userId) {
      this.eventos.emitir(salas.persona(userId), 'pedido.listo', { ...datos, paraMi: true });
      void this.push.avisar([userId], { titulo: p.mesa ? `Mesa ${p.mesa}: pedido listo` : `Ticket #${p.ticket}: pedido listo`, cuerpo: 'Cocina marcó el pedido como listo para servir.', url: '/app/pedidos', etiqueta: `listo-${p.id}`, urgente: true });
    }
  }

  /** Para el cliente de la mesa: su pedido en curso y el avance de cada plato (semáforo de espera). */
  async deMesa(rid: string, mesaId: string) {
    return this.db.run({ restaurantId: rid, restaurantIds: [] }, async (tx) => {
      const [o] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tableId, mesaId), eq(orders.restaurantId, rid), inArray(orders.status, ABIERTO)));
      if (!o) return { pedido: null };
      const p = await this.vista(tx, rid, o.id);
      return { pedido: { total: p.total, items: p.items.filter((i) => !i.anulado).map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, estado: i.porConfirmar ? 'por_confirmar' : i.estado, nota: i.nota })) } };
    });
  }

  /** Pedido del cliente por QR: va al pedido abierto de la mesa. Entra a cocina solo si la sucursal lo permite sin confirmación. */
  async desdeQr(rid: string, mesaId: string, d: z.infer<typeof AgregarItems>, comentario?: string) {
    const t: Tenant = { restaurantId: rid, restaurantIds: [] };
    const info = await this.db.run(t, async (tx) => {
      const [r] = await tx.select({ habilitado: restaurants.qrOrderingEnabled, auto: restaurants.qrAutoSend }).from(restaurants).where(eq(restaurants.id, rid));
      if (!r?.habilitado) throw new ForbiddenException('Este restaurante todavía no recibe pedidos por QR: llama al mesero.');
      const [ya] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tableId, mesaId), eq(orders.restaurantId, rid), inArray(orders.status, ABIERTO)));
      if (ya) return { id: ya.id, auto: r.auto };
      const asig = await tx.execute(sql`SELECT s.id, s.user_id FROM table_assignments ta JOIN staff_members s ON s.id = ta.waiter_id WHERE ta.table_id = ${mesaId} AND ta.valid_during @> now() LIMIT 1`);
      const mesero = (asig.rows as { id: string; user_id: string | null }[])[0];
      const [o] = await tx.insert(orders).values({ restaurantId: rid, tableId: mesaId, waiterId: mesero?.id ?? null, channel: 'qr_mesa', orderType: 'mesa', createdBy: mesero?.user_id ?? null, status: 'borrador', customerComment: comentario ?? null }).returning({ id: orders.id });
      return { id: o.id, auto: r.auto };
    });
    const p = await this.agregar(t, null, info.id, d, true, info.auto);
    if (!info.auto) {
      const dest = await this.db.run(t, (tx) => tx.select({ u: orders.createdBy }).from(orders).where(eq(orders.id, info.id)));
      const evento = { id: p.id, mesa: p.mesa, items: p.items.filter((i) => i.porConfirmar).length };
      this.eventos.emitir(salas.sucursal(rid), 'pedido.qr', { ...evento, paraMi: false });
      const u = dest[0]?.u;
      if (u) { this.eventos.emitir(salas.persona(u), 'pedido.qr', { ...evento, paraMi: true }); void this.push.avisar([u], { titulo: `Mesa ${p.mesa}: pedido por confirmar`, cuerpo: `${evento.items} plato(s) pedidos por QR. Confírmalos con un toque.`, url: '/app/pedidos', etiqueta: `qr-${p.id}`, urgente: true }); }
    }
    return { ok: true, estado: info.auto ? 'enviado' : 'por_confirmar' };
  }
}
