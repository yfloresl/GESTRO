import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { DIAS_DE_GRACIA } from '../comun/guards';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { alcanceDe, MODULOS, type Modulo } from './paquetes';
import { auditLog, plans, platformSettings, restaurants, saasPromotions, subscriptionPayments } from '../database/esquema';
import { StorageService } from '../storage/storage.service';
import { EventosGateway, salas } from '../tiempo-real/eventos.gateway';
import { PushService } from '../tiempo-real/push.service';

export const MAX_IMAGEN = 3 * 1024 * 1024;
const HOY = sql`(now() AT TIME ZONE 'America/La_Paz')::date`;

const Monto = z.number().min(0).max(10_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');
export const NuevoPago = z.object({
  meses: z.number().int().min(1).max(24), monto: Monto.refine((n) => n > 0, 'El monto debe ser mayor a cero'),
  referencia: z.string().trim().min(3).max(60), banco: z.string().trim().max(60).optional(), fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
export const Rechazo = z.object({ motivo: z.string().trim().min(3).max(200) }).strict();
export const Promocion = z.object({
  nombre: z.string().trim().min(2).max(80), mesesRequeridos: z.number().int().min(1).max(24), mesesDeRegalo: z.number().int().min(0).max(24).default(0),
  descuentoPct: z.number().min(0).max(100).default(0), desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), activa: z.boolean().default(true),
}).strict().refine((p) => p.hasta >= p.desde, { message: 'La fecha final no puede ser anterior a la inicial', path: ['hasta'] });
export const Plan = z.object({ codigo: z.string().trim().min(1).max(20), nombre: z.string().trim().min(2).max(60), precioMensual: Monto, activo: z.boolean().default(true) }).strict();
export const AjusteSucursal = z.object({ planId: z.string().uuid().nullable().optional(), habilitadaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), estado: z.enum(['activo', 'suspendido', 'baja']).optional(), motivo: z.string().trim().min(3).max(200) }).strict();

export type EstadoSuscripcion = 'activa' | 'por_vencer' | 'gracia' | 'vencida';

@Injectable()
export class SuscripcionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Suscripcion');
  private reloj?: NodeJS.Timeout;

  constructor(
    @Inject(BD) private readonly bd: Bd,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(EventosGateway) private readonly eventos: EventosGateway,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /** Cada hora revisa los vencimientos (5 días, 1 día y el día en que vence). En las pruebas se invoca a mano. */
  onModuleInit() {
    if (process.env.VITEST === undefined) this.reloj = setInterval(() => { this.avisarVencimientos().catch((e) => this.log.warn(String(e?.message ?? e))); }, 60 * 60_000);
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /** Estado a partir de los días que faltan (negativo = ya venció). Pasada la gracia, la sucursal queda en solo lectura. */
  static estado(dias: number | null): EstadoSuscripcion {
    if (dias === null) return 'vencida';
    if (dias > 5) return 'activa';
    if (dias >= 0) return 'por_vencer';
    return dias >= -DIAS_DE_GRACIA ? 'gracia' : 'vencida';
  }

  /* ---------------- lado del restaurante ---------------- */

  /** Qué módulos incluye el plan de la sucursal (para que la web oculte lo que no hay). Visible a todo el personal. */
  async alcance(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const f = (await tx.execute(sql`SELECT p.code, p.name, p.features FROM restaurants r LEFT JOIN plans p ON p.id = r.plan_id WHERE r.id = ${t.restaurantId}`)).rows[0] as { code: string | null; name: string | null; features: unknown } | undefined;
      const a = alcanceDe(f?.features);
      const incluidos = a.aplicado ? a.modulos! : (Object.keys(MODULOS) as Modulo[]);
      return { plan: f?.name ?? null, codigo: f?.code ?? null, aplicado: a.aplicado, modulos: Object.entries(MODULOS).map(([codigo, nombre]) => ({ codigo, nombre, incluido: incluidos.includes(codigo as Modulo) })) };
    });
  }

  /** Plataforma enciende/apaga la aplicación de los módulos de un plan (por defecto apagada). */
  async aplicarPaquete(id: string, aplicar: boolean) {
    const r = await this.bd.execute(sql`UPDATE plans SET features = jsonb_set(features, '{aplicar}', to_jsonb(${aplicar}::boolean)) WHERE id = ${id} AND features ? 'modulos' RETURNING id`);
    if (!r.rows.length) throw new NotFoundException('Plan no encontrado o sin módulos definidos.');
    return { ok: true, aplicar };
  }

  async mia(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT r.paid_until::text AS hasta, (r.paid_until - ${HOY})::int AS dias, r.status, p.name AS plan, p.monthly_price_bob::text AS precio
        FROM restaurants r LEFT JOIN plans p ON p.id = r.plan_id WHERE r.id = ${t.restaurantId}`);
      const f = r.rows[0] as { hasta: string | null; dias: number | null; status: string; plan: string | null; precio: string | null };
      const pagos = await tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.restaurantId, t.restaurantId)).orderBy(desc(subscriptionPayments.createdAt)).limit(24);
      const [cfg] = await tx.select().from(platformSettings);
      return {
        habilitadaHasta: f.hasta, diasRestantes: f.dias, estado: SuscripcionService.estado(f.dias), sucursal: f.status, plan: f.plan, precioMensual: f.precio, diasDeGracia: DIAS_DE_GRACIA,
        cobro: { instrucciones: cfg?.paymentInstructions ?? null, tieneQr: !!cfg?.paymentQrUrl },
        pagos: pagos.map((p) => ({ id: p.id, meses: p.monthsPaid, mesesDeRegalo: p.giftMonths, monto: p.amountBob, esperado: p.expectedAmount, referencia: p.bankReference, banco: p.bank, estado: p.status, motivo: p.status === 'rechazado' ? p.notes : null, tieneVoucher: !!p.voucherUrl, desde: p.periodFrom, hasta: p.periodTo, creado: p.createdAt.toISOString() })),
      };
    });
  }

  /** Mejor promoción vigente para esa cantidad de meses: más meses de regalo y, a igualdad, más descuento. */
  private async promocion(tx: Bd, meses: number) {
    const r = await tx.execute(sql`SELECT id, name, bonus_months, discount_pct::float8 AS descuento FROM saas_promotions
      WHERE active AND months_required <= ${meses} AND ${HOY} BETWEEN valid_from AND valid_to ORDER BY bonus_months DESC, discount_pct DESC LIMIT 1`);
    return (r.rows[0] as { id: string; name: string; bonus_months: number; descuento: number } | undefined) ?? null;
  }

  async calculo(t: Tenant, meses: number) {
    if (!Number.isInteger(meses) || meses < 1 || meses > 24) throw new BadRequestException('Los meses deben ser de 1 a 24.');
    return this.db.run(t, async (tx) => {
      const promo = await this.promocion(tx, meses);
      const e = await tx.execute(sql`SELECT round(p.monthly_price_bob * ${meses} * (1 - ${promo?.descuento ?? 0}::numeric / 100), 2)::text AS esperado, p.monthly_price_bob::text AS precio
        FROM restaurants r JOIN plans p ON p.id = r.plan_id WHERE r.id = ${t.restaurantId}`);
      const f = e.rows[0] as { esperado: string; precio: string } | undefined;
      return { meses, precioMensual: f?.precio ?? null, montoEsperado: f?.esperado ?? null, promocion: promo ? { nombre: promo.name, mesesDeRegalo: promo.bonus_months, descuentoPct: promo.descuento } : null };
    });
  }

  /** Crea el pago pendiente (sin foto todavía). La referencia bancaria no puede repetirse en pagos no rechazados. */
  crearPago(t: Tenant, userId: string, d: z.infer<typeof NuevoPago>) {
    return this.db.run(t, async (tx) => {
      const promo = await this.promocion(tx, d.meses);
      const e = await tx.execute(sql`SELECT round(p.monthly_price_bob * ${d.meses} * (1 - ${promo?.descuento ?? 0}::numeric / 100), 2)::text AS esperado FROM restaurants r JOIN plans p ON p.id = r.plan_id WHERE r.id = ${t.restaurantId}`);
      const esperado = (e.rows[0] as { esperado: string } | undefined)?.esperado ?? null;
      try {
        const [p] = await tx.insert(subscriptionPayments).values({
          restaurantId: t.restaurantId, monthsPaid: d.meses, amountBob: d.monto.toFixed(2), bankReference: d.referencia, bank: d.banco ?? null, paidOn: d.fechaPago ?? null,
          createdBy: userId, promotionId: promo?.id ?? null, giftMonths: promo?.bonus_months ?? 0, expectedAmount: esperado,
        }).returning({ id: subscriptionPayments.id });
        await auditar(tx, t.restaurantId, userId, 'suscripcion.pago_creado', 'subscription_payment', p.id, { meses: d.meses, monto: d.monto, referencia: d.referencia });
        return { id: p.id, mesesDeRegalo: promo?.bonus_months ?? 0, promocion: promo?.name ?? null };
      } catch (e2) {
        if (esDuplicado(e2)) throw new ConflictException('Esa referencia bancaria ya fue usada en otro pago. Revisa el número del comprobante.');
        throw e2;
      }
    });
  }

  subirVoucher(t: Tenant, userId: string, id: string, datos: Buffer) {
    return this.db.run(t, async (tx) => {
      const [p] = await tx.select().from(subscriptionPayments).where(and(eq(subscriptionPayments.id, id), eq(subscriptionPayments.restaurantId, t.restaurantId)));
      if (!p) throw new NotFoundException('Pago no encontrado.');
      if (p.status !== 'pendiente') throw new ConflictException('Este pago ya fue revisado.');
      const clave = await this.storage.guardarImagen(t.restaurantId, 'vouchers', datos, MAX_IMAGEN);
      await tx.update(subscriptionPayments).set({ voucherUrl: clave }).where(eq(subscriptionPayments.id, id));
      if (p.voucherUrl) await this.storage.borrar(p.voucherUrl);
      await auditar(tx, t.restaurantId, userId, 'suscripcion.voucher_subido', 'subscription_payment', id);
      return { ok: true };
    });
  }

  async voucherDeMiPago(t: Tenant, id: string): Promise<Buffer> {
    const [p] = await this.db.run(t, (tx) => tx.select({ v: subscriptionPayments.voucherUrl }).from(subscriptionPayments).where(and(eq(subscriptionPayments.id, id), eq(subscriptionPayments.restaurantId, t.restaurantId))));
    if (!p?.v) throw new NotFoundException();
    return this.storage.leer(p.v);
  }

  async qrDeCobro(): Promise<Buffer> {
    const [c] = await this.bd.select({ q: platformSettings.paymentQrUrl }).from(platformSettings);
    if (!c?.q) throw new NotFoundException('Kyros-Tech todavía no cargó el QR de cobro.');
    return this.storage.leer(c.q);
  }

  /* ---------------- consola de plataforma (Kyros-Tech) ---------------- */

  /** Pagos con voucher a la vista. `coincide` compara lo declarado con el precio del plan (si hay plan). */
  async pagos(estado: 'pendiente' | 'validado' | 'rechazado' | 'todos') {
    const r = await this.bd.execute(sql`SELECT p.id, p.restaurant_id, r.name AS sucursal, a.legal_name AS cuenta, p.months_paid, p.gift_months, p.amount_bob::text AS monto, p.expected_amount::text AS esperado,
        p.bank_reference, p.bank, p.paid_on::text, p.status, p.notes, (p.voucher_url IS NOT NULL) AS tiene_voucher, p.created_at, r.paid_until::text AS hasta_actual, pr.name AS promocion
      FROM subscription_payments p JOIN restaurants r ON r.id = p.restaurant_id JOIN accounts a ON a.id = r.account_id LEFT JOIN saas_promotions pr ON pr.id = p.promotion_id
      WHERE ${estado === 'todos' ? sql`true` : sql`p.status = ${estado}`} ORDER BY p.created_at DESC LIMIT 200`);
    return (r.rows as Record<string, unknown>[]).map((x) => ({
      id: x.id, sucursalId: x.restaurant_id, sucursal: x.sucursal, cuenta: x.cuenta, meses: x.months_paid, mesesDeRegalo: x.gift_months, monto: x.monto, esperado: x.esperado,
      coincide: x.esperado ? x.esperado === x.monto : null, referencia: x.bank_reference, banco: x.bank, fechaPago: x.paid_on, estado: x.status, motivo: x.status === 'rechazado' ? x.notes : null,
      tieneVoucher: x.tiene_voucher, creado: new Date(String(x.created_at)).toISOString(), habilitadaHasta: x.hasta_actual, promocion: x.promocion,
    }));
  }

  async voucherDePlataforma(id: string): Promise<Buffer> {
    const [p] = await this.bd.select({ v: subscriptionPayments.voucherUrl }).from(subscriptionPayments).where(eq(subscriptionPayments.id, id));
    if (!p?.v) throw new NotFoundException('Ese pago no tiene voucher.');
    return this.storage.leer(p.v);
  }

  /**
   * Aprueba un pago: habilita desde max(hoy, vencimiento + 1 día) por los meses pagados más los de regalo.
   * La decisión es siempre de una persona; aquí no interviene ninguna IA.
   */
  async aprobar(userId: string, id: string) {
    const r = await this.bd.transaction(async (tx) => {
      const [p] = (await tx.execute(sql`SELECT * FROM subscription_payments WHERE id = ${id} FOR UPDATE`)).rows as { restaurant_id: string; status: string; months_paid: number; gift_months: number; voucher_url: string | null }[];
      if (!p) throw new NotFoundException('Pago no encontrado.');
      if (p.status !== 'pendiente') throw new ConflictException('Este pago ya fue revisado.');
      if (!p.voucher_url) throw new BadRequestException('El restaurante todavía no subió la foto del comprobante.');
      const meses = p.months_paid + p.gift_months;
      const inicio = (await tx.execute(sql`SELECT GREATEST(${HOY}, COALESCE(paid_until + 1, ${HOY}))::text AS desde FROM restaurants WHERE id = ${p.restaurant_id} FOR UPDATE`)).rows[0] as { desde: string };
      const u = await tx.execute(sql`UPDATE restaurants SET paid_until = ((${inicio.desde}::date + make_interval(months => ${meses}))::date - 1),
          status = CASE WHEN status = 'suspendido' THEN 'activo' ELSE status END WHERE id = ${p.restaurant_id} RETURNING paid_until::text AS hasta`);
      const f = { hasta: (u.rows[0] as { hasta: string }).hasta, desde: inicio.desde };
      await tx.update(subscriptionPayments).set({ status: 'validado', validatedBy: userId, validatedAt: sql`now()` as unknown as Date, periodFrom: f.desde, periodTo: f.hasta }).where(eq(subscriptionPayments.id, id));
      await tx.insert(auditLog).values({ restaurantId: p.restaurant_id, userId, action: 'suscripcion.pago_aprobado', entity: 'subscription_payment', entityId: id, after: { desde: f.desde, hasta: f.hasta, meses } });
      return { restaurantId: p.restaurant_id, desde: f.desde, hasta: f.hasta, meses };
    });
    this.eventos.emitir(salas.sucursal(r.restaurantId), 'suscripcion.estado', { estado: 'aprobado', hasta: r.hasta });
    void this.avisarDuenos(r.restaurantId, { titulo: 'Pago aprobado', cuerpo: `Tu suscripción está habilitada hasta el ${r.hasta}.`, url: '/app/suscripcion' });
    return r;
  }

  async rechazar(userId: string, id: string, motivo: string) {
    const r = await this.bd.transaction(async (tx) => {
      const [p] = await tx.update(subscriptionPayments).set({ status: 'rechazado', notes: motivo, validatedBy: userId, validatedAt: sql`now()` as unknown as Date })
        .where(and(eq(subscriptionPayments.id, id), eq(subscriptionPayments.status, 'pendiente'))).returning({ rid: subscriptionPayments.restaurantId });
      if (!p) throw new ConflictException('El pago no existe o ya fue revisado.');
      await tx.insert(auditLog).values({ restaurantId: p.rid, userId, action: 'suscripcion.pago_rechazado', entity: 'subscription_payment', entityId: id, after: { motivo } });
      return p.rid;
    });
    this.eventos.emitir(salas.sucursal(r), 'suscripcion.estado', { estado: 'rechazado' });
    void this.avisarDuenos(r, { titulo: 'Pago rechazado', cuerpo: motivo, url: '/app/suscripcion', urgente: true });
    return { ok: true };
  }

  async cobro() {
    const [c] = await this.bd.select().from(platformSettings);
    return { instrucciones: c?.paymentInstructions ?? '', tieneQr: !!c?.paymentQrUrl };
  }
  async guardarCobro(instrucciones: string) {
    await this.bd.insert(platformSettings).values({ id: 1, paymentInstructions: instrucciones }).onConflictDoUpdate({ target: platformSettings.id, set: { paymentInstructions: instrucciones, updatedAt: sql`now()` as unknown as Date } });
    return { ok: true };
  }
  async guardarQr(datos: Buffer) {
    const clave = await this.storage.guardarImagenEn('plataforma/cobro', datos, MAX_IMAGEN);
    const [antes] = await this.bd.select({ q: platformSettings.paymentQrUrl }).from(platformSettings);
    await this.bd.insert(platformSettings).values({ id: 1, paymentQrUrl: clave }).onConflictDoUpdate({ target: platformSettings.id, set: { paymentQrUrl: clave, updatedAt: sql`now()` as unknown as Date } });
    if (antes?.q) await this.storage.borrar(antes.q);
    return { ok: true };
  }

  promociones() { return this.bd.select().from(saasPromotions).orderBy(desc(saasPromotions.validTo)).then((r) => r.map((p) => ({ id: p.id, nombre: p.name, mesesRequeridos: p.monthsRequired, mesesDeRegalo: p.bonusMonths, descuentoPct: Number(p.discountPct), desde: p.validFrom, hasta: p.validTo, activa: p.active }))); }
  async crearPromocion(d: z.infer<typeof Promocion>) {
    const [p] = await this.bd.insert(saasPromotions).values({ name: d.nombre, monthsRequired: d.mesesRequeridos, bonusMonths: d.mesesDeRegalo, discountPct: String(d.descuentoPct), validFrom: d.desde, validTo: d.hasta, active: d.activa }).returning({ id: saasPromotions.id });
    return { id: p.id };
  }
  async cambiarPromocion(id: string, d: z.infer<typeof Promocion>) {
    const r = await this.bd.update(saasPromotions).set({ name: d.nombre, monthsRequired: d.mesesRequeridos, bonusMonths: d.mesesDeRegalo, discountPct: String(d.descuentoPct), validFrom: d.desde, validTo: d.hasta, active: d.activa }).where(eq(saasPromotions.id, id)).returning({ id: saasPromotions.id });
    if (!r.length) throw new NotFoundException('Promoción no encontrada.');
    return { ok: true };
  }

  planes() { return this.bd.select().from(plans).orderBy(plans.monthlyPriceBob).then((r) => r.map((p) => ({ id: p.id, codigo: p.code, nombre: p.name, precioMensual: p.monthlyPriceBob, activo: p.active, modulos: alcanceDe(p.features).modulos, aplicado: alcanceDe(p.features).aplicado }))); }
  async crearPlan(d: z.infer<typeof Plan>) {
    try { const [p] = await this.bd.insert(plans).values({ code: d.codigo, name: d.nombre, monthlyPriceBob: d.precioMensual.toFixed(2), active: d.activo }).returning({ id: plans.id }); return { id: p.id }; }
    catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un plan con ese código.'); throw e; }
  }
  async cambiarPlan(id: string, d: z.infer<typeof Plan>) {
    const r = await this.bd.update(plans).set({ code: d.codigo, name: d.nombre, monthlyPriceBob: d.precioMensual.toFixed(2), active: d.activo }).where(eq(plans.id, id)).returning({ id: plans.id });
    if (!r.length) throw new NotFoundException('Plan no encontrado.');
    return { ok: true };
  }

  async sucursales() {
    const r = await this.bd.execute(sql`SELECT r.id, r.name, a.legal_name AS cuenta, r.status, r.paid_until::text AS hasta, (r.paid_until - ${HOY})::int AS dias, p.name AS plan, r.plan_id
      FROM restaurants r JOIN accounts a ON a.id = r.account_id LEFT JOIN plans p ON p.id = r.plan_id ORDER BY a.legal_name, r.name LIMIT 500`);
    return (r.rows as { id: string; name: string; cuenta: string; status: string; hasta: string | null; dias: number | null; plan: string | null; plan_id: string | null }[])
      .map((x) => ({ id: x.id, nombre: x.name, cuenta: x.cuenta, estado: x.status, habilitadaHasta: x.hasta, diasRestantes: x.dias, suscripcion: SuscripcionService.estado(x.dias), plan: x.plan, planId: x.plan_id }));
  }

  /** Ajuste manual de plataforma (plan, fecha, suspensión): siempre con motivo y auditado. */
  async ajustarSucursal(userId: string, id: string, d: z.infer<typeof AjusteSucursal>) {
    const cambios = { ...(d.planId !== undefined && { planId: d.planId }), ...(d.habilitadaHasta !== undefined && { paidUntil: d.habilitadaHasta }), ...(d.estado !== undefined && { status: d.estado }) };
    if (!Object.keys(cambios).length) throw new BadRequestException('Nada que cambiar.');
    return this.bd.transaction(async (tx) => {
      const r = await tx.update(restaurants).set(cambios).where(eq(restaurants.id, id)).returning({ id: restaurants.id });
      if (!r.length) throw new NotFoundException('Sucursal no encontrada.');
      await tx.insert(auditLog).values({ restaurantId: id, userId, action: 'plataforma.sucursal_ajustada', entity: 'restaurant', entityId: id, after: d });
      return { ok: true };
    });
  }

  /* ---------------- avisos de vencimiento ---------------- */

  private async avisarDuenos(rid: string, aviso: { titulo: string; cuerpo: string; url: string; urgente?: boolean }) {
    const r = await this.bd.execute(sql`SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.restaurant_id = ${rid} AND ro.code IN ('owner','admin')`);
    await this.push.avisar((r.rows as { user_id: string }[]).map((x) => x.user_id), aviso);
  }

  /** Avisa al titular a 5 días, a 1 día y el día del vencimiento. Cada aviso sale una sola vez por sucursal y fecha. */
  async avisarVencimientos(): Promise<number> {
    const r = await this.bd.execute(sql`SELECT id, paid_until::text AS hasta, (paid_until - ${HOY})::int AS dias FROM restaurants WHERE status = 'activo' AND paid_until IS NOT NULL AND (paid_until - ${HOY}) IN (5, 1, 0)`);
    let n = 0;
    for (const x of r.rows as { id: string; hasta: string; dias: number }[]) {
      const tipo = x.dias === 5 ? 'd5' : x.dias === 1 ? 'd1' : 'd0';
      const nuevo = await this.bd.execute(sql`INSERT INTO subscription_notices (restaurant_id, kind, paid_until) VALUES (${x.id}, ${tipo}, ${x.hasta}) ON CONFLICT DO NOTHING RETURNING 1`);
      if (!nuevo.rows.length) continue;
      const texto = x.dias === 0 ? 'Tu suscripción vence hoy.' : `Tu suscripción vence en ${x.dias} ${x.dias === 1 ? 'día' : 'días'} (${x.hasta}).`;
      this.eventos.emitir(salas.sucursal(x.id), 'suscripcion.estado', { estado: 'por_vencer', dias: x.dias });
      await this.avisarDuenos(x.id, { titulo: 'Suscripción por vencer', cuerpo: `${texto} Sube tu comprobante para seguir sin interrupciones.`, url: '/app/suscripcion', urgente: x.dias <= 1 });
      n++;
    }
    return n;
  }
}
