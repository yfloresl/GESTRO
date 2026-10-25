import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { accounts, cashSessions, orders, receipts, restaurants, salesPayments } from '../database/esquema';
import { EventosGateway, salas } from '../tiempo-real/eventos.gateway';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { PedidosService } from './pedidos.service';

const Monto = z.number().min(0).max(10_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');
export const AbrirCaja = z.object({ montoInicial: Monto }).strict();
export const CerrarCaja = z.object({ montoContado: Monto }).strict();
export const Cobro = z.object({
  metodo: z.enum(['efectivo', 'qr', 'tarjeta', 'transferencia', 'credito']),
  documento: z.enum(['recibo', 'ninguno', 'factura']).default('recibo'),
  nombreCliente: z.string().trim().max(120).optional(),
}).strict();
export const AjustesSucursal = z.object({
  pedidosPorQr: z.boolean().optional(), qrSinConfirmacion: z.boolean().optional(), modoDeCobro: z.enum(['recibo', 'ninguno']).optional(),
  margenMinimo: z.number().min(0).max(100).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales').optional(),
}).strict();

@Injectable()
export class CajaService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PedidosService) private readonly pedidos: PedidosService,
    @Inject(EventosGateway) private readonly eventos: EventosGateway,
    @Inject(ContabilidadService) private readonly conta: ContabilidadService,
  ) {}

  private async abierta(tx: Bd, t: Tenant, userId: string) {
    const [c] = await tx.select().from(cashSessions).where(and(eq(cashSessions.restaurantId, t.restaurantId), eq(cashSessions.cashierId, userId), isNull(cashSessions.closedAt)));
    return c ?? null;
  }

  /** Cobros no anulados de una caja, por método. El efectivo esperado es la apertura más lo cobrado en efectivo. */
  private async resumen(tx: Bd, c: typeof cashSessions.$inferSelect) {
    const r = await tx.execute(sql`SELECT method, COALESCE(SUM(amount), 0)::text AS total, count(*)::int AS n FROM sales_payments WHERE cash_session_id = ${c.id} AND voided_at IS NULL GROUP BY method`);
    const filas = r.rows as { method: string; total: string; n: number }[];
    const efectivo = filas.find((f) => f.method === 'efectivo')?.total ?? '0';
    const esp = await tx.execute(sql`SELECT (${c.openingAmount}::numeric + ${efectivo}::numeric)::text AS esperado`);
    return { activa: true as const, id: c.id, desde: c.openedAt.toISOString(), montoInicial: c.openingAmount, cobros: filas.map((f) => ({ metodo: f.method, total: f.total, cantidad: f.n })), efectivoEsperado: (esp.rows[0] as { esperado: string }).esperado };
  }

  actual(t: Tenant, userId: string) {
    return this.db.run(t, async (tx) => { const c = await this.abierta(tx, t, userId); return c ? this.resumen(tx, c) : { activa: false as const }; });
  }

  abrir(t: Tenant, userId: string, d: z.infer<typeof AbrirCaja>) {
    return this.db.run(t, async (tx) => {
      if (await this.abierta(tx, t, userId)) throw new ConflictException('Ya tienes una caja abierta.');
      const [c] = await tx.insert(cashSessions).values({ restaurantId: t.restaurantId, cashierId: userId, openingAmount: d.montoInicial.toFixed(2) }).returning();
      await auditar(tx, t.restaurantId, userId, 'caja.abierta', 'cash_session', c.id, d);
      return this.resumen(tx, c);
    });
  }

  /** Cierre con arqueo: compara lo contado con lo esperado y deja la diferencia registrada. */
  cerrar(t: Tenant, userId: string, d: z.infer<typeof CerrarCaja>) {
    return this.db.run(t, async (tx) => {
      const c = await this.abierta(tx, t, userId);
      if (!c) throw new ConflictException('No tienes una caja abierta.');
      const pend = await tx.execute(sql`SELECT count(*)::int AS n FROM orders WHERE restaurant_id = ${t.restaurantId} AND status IN ('borrador','enviado','en_preparacion','listo','servido') AND total > 0 AND created_by = ${userId} AND order_type <> 'mesa'`);
      const r = await this.resumen(tx, c);
      const dif = await tx.execute(sql`SELECT (${d.montoContado.toFixed(2)}::numeric - ${r.efectivoEsperado}::numeric)::text AS dif`);
      await tx.update(cashSessions).set({ closedAt: sql`now()` as unknown as Date, countedAmount: d.montoContado.toFixed(2) }).where(eq(cashSessions.id, c.id));
      const diferencia = (dif.rows[0] as { dif: string }).dif;
      await auditar(tx, t.restaurantId, userId, 'caja.cerrada', 'cash_session', c.id, { contado: d.montoContado, esperado: r.efectivoEsperado, diferencia });
      return { ...r, montoContado: d.montoContado.toFixed(2), diferencia, pedidosSinCobrar: (pend.rows[0] as { n: number }).n };
    });
  }

  /**
   * Cobra el pedido completo. La suma sale de la base; el documento lo limita el modo de cobro de la sucursal.
   * La factura SIN no existe todavía (Servicio Fiscal aparte): se rechaza con un mensaje claro.
   */
  async cobrar(t: Tenant, userId: string, id: string, d: z.infer<typeof Cobro>) {
    const r = await this.db.run(t, async (tx) => {
      const caja = await this.abierta(tx, t, userId);
      if (!caja) throw new ConflictException('Abre tu caja antes de cobrar.');
      const [rest] = await tx.select({ modo: restaurants.billingMode }).from(restaurants).where(eq(restaurants.id, t.restaurantId));
      if (d.documento === 'factura') throw new UnprocessableEntityException('La factura electrónica del SIN todavía no está disponible. Emite un recibo o solo contabiliza.');
      if (rest?.modo === 'ninguno' && d.documento !== 'ninguno') throw new UnprocessableEntityException('Esta sucursal solo contabiliza: no emite recibos.');
      const bloqueo = await tx.execute(sql`SELECT id, status, total::text AS total, customer_name FROM orders WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`);
      const o = (bloqueo.rows as { id: string; status: string; total: string; customer_name: string | null }[])[0];
      if (!o) throw new NotFoundException('Pedido no encontrado.');
      if (['cobrado', 'anulado'].includes(o.status)) throw new ConflictException('Este pedido ya está cerrado.');
      const sinEnviar = await tx.execute(sql`SELECT count(*)::int AS n FROM order_items WHERE order_id = ${id} AND voided_at IS NULL AND status = 'borrador'`);
      if ((sinEnviar.rows[0] as { n: number }).n > 0) throw new ConflictException('Hay platos sin enviar o sin confirmar. Envíalos o quítalos antes de cobrar.');
      if (!(Number(o.total) > 0)) throw new BadRequestException('El pedido no tiene platos para cobrar.');
      const [p] = await tx.insert(salesPayments).values({ restaurantId: t.restaurantId, orderId: id, cashSessionId: caja.id, method: d.metodo, amount: o.total, document: d.documento, customerName: d.nombreCliente ?? o.customer_name }).returning();
      let recibo: number | null = null;
      if (d.documento === 'recibo') {
        const n = await tx.execute(sql`INSERT INTO receipt_counters (restaurant_id, last_number) VALUES (${t.restaurantId}, 1) ON CONFLICT (restaurant_id) DO UPDATE SET last_number = receipt_counters.last_number + 1 RETURNING last_number`);
        recibo = Number((n.rows[0] as { last_number: string }).last_number);
        await tx.insert(receipts).values({ restaurantId: t.restaurantId, number: recibo, orderId: id, customerName: d.nombreCliente ?? o.customer_name, amount: o.total });
        await tx.update(salesPayments).set({ receiptNumber: recibo }).where(eq(salesPayments.id, p.id));
      }
      await tx.update(orders).set({ status: 'cobrado', closedAt: sql`now()` as unknown as Date }).where(eq(orders.id, id));
      await this.conta.ventaCobrada(tx, t, userId, { pagoId: p.id, total: o.total, metodo: d.metodo, documento: d.documento });
      await auditar(tx, t.restaurantId, userId, 'venta.cobrada', 'sales_payment', p.id, { metodo: d.metodo, documento: d.documento, monto: o.total, recibo });
      return { pagoId: p.id, monto: o.total, recibo, documento: d.documento };
    });
    this.eventos.emitir(salas.sucursal(t.restaurantId), 'pedido.cobrado', { id });
    return r;
  }

  /** Una venta cobrada no se borra: se anula con motivo, queda quién y cuándo, y el pedido pasa a «anulado». */
  anularPago(t: Tenant, userId: string, id: string, motivo: string) {
    return this.db.run(t, async (tx) => {
      const [p] = await tx.update(salesPayments).set({ voidedAt: sql`now()` as unknown as Date, voidedBy: userId, voidReason: motivo }).where(and(eq(salesPayments.id, id), eq(salesPayments.restaurantId, t.restaurantId), isNull(salesPayments.voidedAt))).returning();
      if (!p) throw new NotFoundException('Pago no encontrado o ya anulado.');
      await tx.update(orders).set({ status: 'anulado' }).where(eq(orders.id, p.orderId));
      await this.conta.ventaAnulada(tx, t, userId, id, motivo);
      await auditar(tx, t.restaurantId, userId, 'venta.anulada', 'sales_payment', id, { motivo });
      return { ok: true };
    });
  }

  /** Datos del recibo para imprimir (58 u 80 mm desde el navegador). Rotulado: no es un documento fiscal. */
  recibo(t: Tenant, id: string) {
    return this.db.run(t, async (tx) => {
      const [r] = await tx.select().from(receipts).where(and(eq(receipts.id, id), eq(receipts.restaurantId, t.restaurantId)));
      if (!r) throw new NotFoundException('Recibo no encontrado.');
      const [rest] = await tx.select({ nombre: restaurants.name, razon: accounts.legalName, nit: accounts.nit }).from(restaurants).innerJoin(accounts, eq(accounts.id, restaurants.accountId)).where(eq(restaurants.id, t.restaurantId));
      const [pago] = await tx.select().from(salesPayments).where(and(eq(salesPayments.receiptNumber, r.number), eq(salesPayments.restaurantId, t.restaurantId)));
      const pedido = r.orderId ? await this.pedidos.vista(tx, t.restaurantId, r.orderId) : null;
      return {
        id: r.id, numero: r.number, emitido: r.issuedAt.toISOString(), monto: r.amount, cliente: r.customerName, metodo: pago?.method ?? null, anulado: !!pago?.voidedAt, motivoAnulacion: pago?.voidReason ?? null,
        restaurante: rest?.nombre ?? '', razonSocial: rest?.razon ?? '', nit: rest?.nit ?? null,
        mesa: pedido?.mesa ?? null, ticket: pedido?.ticket ?? null, items: (pedido?.items ?? []).filter((i) => !i.anulado && !i.porConfirmar).map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio })),
        leyenda: 'RECIBO — NO ES UNA FACTURA',
      };
    });
  }

  /** Recibos de un pedido (para reimprimir desde la lista del día). */
  reciboDePedido(t: Tenant, orderId: string) {
    return this.db.run(t, async (tx) => { const [r] = await tx.select({ id: receipts.id }).from(receipts).where(and(eq(receipts.orderId, orderId), eq(receipts.restaurantId, t.restaurantId))); return r ?? null; });
  }

  ajustes(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const [r] = await tx.select({ qr: restaurants.qrOrderingEnabled, auto: restaurants.qrAutoSend, modo: restaurants.billingMode, margen: restaurants.minMarginPct }).from(restaurants).where(eq(restaurants.id, t.restaurantId));
      return { pedidosPorQr: r.qr, qrSinConfirmacion: r.auto, modoDeCobro: r.modo, margenMinimo: Number(r.margen) };
    });
  }

  cambiarAjustes(t: Tenant, userId: string, d: z.infer<typeof AjustesSucursal>) {
    return this.db.run(t, async (tx) => {
      const cambios = { ...(d.pedidosPorQr !== undefined && { qrOrderingEnabled: d.pedidosPorQr }), ...(d.qrSinConfirmacion !== undefined && { qrAutoSend: d.qrSinConfirmacion }), ...(d.modoDeCobro !== undefined && { billingMode: d.modoDeCobro }), ...(d.margenMinimo !== undefined && { minMarginPct: d.margenMinimo.toFixed(2) }) };
      if (!Object.keys(cambios).length) throw new BadRequestException('Nada que cambiar.');
      await tx.update(restaurants).set(cambios).where(eq(restaurants.id, t.restaurantId));
      await auditar(tx, t.restaurantId, userId, 'sucursal.ajustes', 'restaurant', t.restaurantId, d);
      return { ok: true };
    });
  }
}
