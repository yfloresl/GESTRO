import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { uuidArray } from '../comun/sql';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { ConsumoService } from '../recetas/consumo.service';
import { RecetasService } from '../recetas/recetas.service';
import { InventarioService } from '../inventario/inventario.service';

/** Si el precio de un insumo sube más que esto contra la compra anterior al mismo proveedor, se alerta. Provisional: ajuste por sucursal. */
export const UMBRAL_ALZA_PCT = 10;
const Cant = z.number().positive().max(1_000_000).refine((n) => Math.round(n * 1000) / 1000 === n, 'Máximo 3 decimales');
const Costo = z.number().min(0).max(1_000_000).refine((n) => Math.round(n * 10000) / 10000 === n, 'Máximo 4 decimales');
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Proveedor = z.object({
  nombre: z.string().trim().min(2).max(120), nit: z.string().trim().max(30).nullable().optional(), telefono: z.string().trim().max(30).nullable().optional(), email: z.string().trim().email().max(200).nullable().optional(),
  diasEntrega: z.number().int().min(0).max(60).default(1), diasCredito: z.number().int().min(0).max(365).default(0), activo: z.boolean().default(true),
}).strict();
export const NuevaOrden = z.object({
  proveedorId: z.string().uuid(), esperadaEl: Fecha.optional(), notas: z.string().trim().max(300).optional(),
  lineas: z.array(z.object({ insumoId: z.string().uuid(), cantidad: Cant, costoUnitario: Costo }).strict()).min(1).max(100),
}).strict();
export const Recepcion = z.object({
  almacenId: z.string().uuid(), factura: z.string().trim().max(40).optional(), conIva: z.boolean().default(false), notas: z.string().trim().max(300).optional(),
  lineas: z.array(z.object({ insumoId: z.string().uuid(), cantidad: Cant, costoUnitario: Costo.optional(), lote: z.string().trim().min(1).max(40).optional(), vence: Fecha.optional() }).strict()).min(1).max(100),
}).strict();
export const Pago = z.object({ metodo: z.enum(['caja', 'bancos']).default('caja'), monto: z.number().positive().max(10_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales').optional() }).strict();

const HOY = sql`(now() AT TIME ZONE 'America/La_Paz')::date`;

@Injectable()
export class ComprasService {
  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ConsumoService) private readonly consumo: ConsumoService,
    @Inject(RecetasService) private readonly recetas: RecetasService,
    @Inject(InventarioService) private readonly inventario: InventarioService,
    @Inject(ContabilidadService) private readonly conta: ContabilidadService,
  ) {}

  /* ---------------- proveedores ---------------- */

  proveedores(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT id, name, nit, phone, email, lead_days, payment_days, active FROM suppliers WHERE restaurant_id = ${t.restaurantId} ORDER BY name`);
      return (r.rows as { id: string; name: string; nit: string | null; phone: string | null; email: string | null; lead_days: number; payment_days: number; active: boolean }[]).map((s) => ({ id: s.id, nombre: s.name, nit: s.nit, telefono: s.phone, email: s.email, diasEntrega: s.lead_days, diasCredito: s.payment_days, activo: s.active }));
    });
  }

  crearProveedor(t: Tenant, por: string, d: z.infer<typeof Proveedor>) {
    return this.db.run(t, async (tx) => {
      try {
        const r = await tx.execute(sql`INSERT INTO suppliers (restaurant_id, name, nit, phone, email, lead_days, payment_days, active) VALUES (${t.restaurantId}, ${d.nombre}, ${d.nit ?? null}, ${d.telefono ?? null}, ${d.email ?? null}, ${d.diasEntrega}, ${d.diasCredito}, ${d.activo}) RETURNING id`);
        const id = (r.rows[0] as { id: string }).id;
        await auditar(tx, t.restaurantId, por, 'compras.proveedor_creado', 'supplier', id, d);
        return { id };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un proveedor con ese nombre.'); throw e; }
    });
  }

  cambiarProveedor(t: Tenant, por: string, id: string, d: z.infer<typeof Proveedor>) {
    return this.db.run(t, async (tx) => {
      try {
        const r = await tx.execute(sql`UPDATE suppliers SET name = ${d.nombre}, nit = ${d.nit ?? null}, phone = ${d.telefono ?? null}, email = ${d.email ?? null}, lead_days = ${d.diasEntrega}, payment_days = ${d.diasCredito}, active = ${d.activo} WHERE id = ${id} AND restaurant_id = ${t.restaurantId} RETURNING id`);
        if (!r.rows.length) throw new NotFoundException('Proveedor no encontrado.');
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un proveedor con ese nombre.'); throw e; }
      await auditar(tx, t.restaurantId, por, 'compras.proveedor_cambiado', 'supplier', id, d);
      return { ok: true };
    });
  }

  /** Historial de precios de un insumo por proveedor (más reciente primero) y el último de cada uno para comparar. */
  precios(t: Tenant, insumoId: string) {
    return this.db.run(t, async (tx) => {
      const h = await tx.execute(sql`SELECT p.id, s.name AS proveedor, p.supplier_id, p.unit_cost::text AS costo, p.recorded_at FROM supplier_prices p JOIN suppliers s ON s.id = p.supplier_id WHERE p.restaurant_id = ${t.restaurantId} AND p.ingredient_id = ${insumoId} ORDER BY p.recorded_at DESC, p.id DESC LIMIT 200`);
      const filas = (h.rows as { id: string; proveedor: string; supplier_id: string; costo: string; recorded_at: string }[]).map((x) => ({ proveedorId: x.supplier_id, proveedor: x.proveedor, costo: x.costo, fecha: new Date(String(x.recorded_at)).toISOString() }));
      const ultimos = new Map<string, (typeof filas)[number]>();
      for (const f of filas) if (!ultimos.has(f.proveedorId)) ultimos.set(f.proveedorId, f);
      return { historial: filas, comparacion: [...ultimos.values()].sort((a, b) => Number(a.costo) - Number(b.costo)) };
    });
  }

  /* ---------------- órdenes de compra ---------------- */

  private async fechaEntrega(tx: Bd, proveedorId: string): Promise<string> {
    return ((await tx.execute(sql`SELECT (${HOY} + COALESCE((SELECT lead_days FROM suppliers WHERE id = ${proveedorId}), 1))::text AS d`)).rows[0] as { d: string }).d;
  }

  private async crearOrden(tx: Bd, t: Tenant, por: string, o: { proveedorId: string; esperadaEl?: string; notas?: string; planDate?: string; lineas: { insumoId: string; cantidad: string; costoUnitario: string }[] }) {
    const [p] = (await tx.execute(sql`SELECT 1 FROM suppliers WHERE id = ${o.proveedorId} AND restaurant_id = ${t.restaurantId} AND active`)).rows;
    if (!p) throw new BadRequestException('El proveedor no existe o está inactivo.');
    if (new Set(o.lineas.map((l) => l.insumoId)).size !== o.lineas.length) throw new BadRequestException('Un insumo solo puede aparecer una vez en la orden.');
    const ids = o.lineas.map((l) => l.insumoId);
    const ok = (await tx.execute(sql`SELECT count(*)::int AS n FROM ingredients WHERE restaurant_id = ${t.restaurantId} AND active AND id = ANY(${uuidArray(ids)})`)).rows[0] as { n: number };
    if (ok.n !== ids.length) throw new BadRequestException('Alguno de los insumos no existe o está desactivado.');
    const esperada = o.esperadaEl ?? (await this.fechaEntrega(tx, o.proveedorId));
    const orden = (await tx.execute(sql`INSERT INTO purchase_orders (restaurant_id, supplier_id, expected_on, notes, created_by, plan_date) VALUES (${t.restaurantId}, ${o.proveedorId}, ${esperada}::date, ${o.notas ?? null}, ${por}::uuid, ${o.planDate ?? null}::date) RETURNING id`)).rows[0] as { id: string };
    for (const l of o.lineas) await tx.execute(sql`INSERT INTO purchase_order_lines (restaurant_id, purchase_order_id, ingredient_id, qty, unit_cost) VALUES (${t.restaurantId}, ${orden.id}, ${l.insumoId}, ${l.cantidad}::numeric, ${l.costoUnitario}::numeric)`);
    await tx.execute(sql`UPDATE purchase_orders SET total = (SELECT COALESCE(SUM(round(qty * unit_cost, 2)), 0) FROM purchase_order_lines WHERE purchase_order_id = ${orden.id}) WHERE id = ${orden.id}`);
    await auditar(tx, t.restaurantId, por, 'compras.orden_creada', 'purchase_order', orden.id, { proveedorId: o.proveedorId, lineas: o.lineas.length, planDate: o.planDate });
    return orden.id;
  }

  crear(t: Tenant, por: string, d: z.infer<typeof NuevaOrden>) {
    return this.db.run(t, async (tx) => {
      const id = await this.crearOrden(tx, t, por, { proveedorId: d.proveedorId, esperadaEl: d.esperadaEl, notas: d.notas, lineas: d.lineas.map((l) => ({ insumoId: l.insumoId, cantidad: l.cantidad.toFixed(3), costoUnitario: l.costoUnitario.toFixed(4) })) });
      return this.vista(tx, t, id);
    });
  }

  private async vista(tx: Bd, t: Tenant, id: string) {
    const [o] = (await tx.execute(sql`SELECT o.id, o.status, o.expected_on::text AS esperada, o.total::text AS total, o.notes, o.plan_date::text AS plan, o.created_at, o.sent_at, s.id AS sid, s.name AS proveedor, s.lead_days
      FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ${id} AND o.restaurant_id = ${t.restaurantId}`)).rows as Record<string, string | number | null>[];
    if (!o) throw new NotFoundException('Orden no encontrada.');
    const l = (await tx.execute(sql`SELECT l.ingredient_id, i.name, i.unit_code, l.qty::text AS qty, l.received_qty::text AS recibido, GREATEST(l.qty - l.received_qty, 0)::numeric(14,3)::text AS pendiente, l.unit_cost::text AS costo FROM purchase_order_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.purchase_order_id = ${id} ORDER BY i.name`)).rows as Record<string, string>[];
    const rc = (await tx.execute(sql`SELECT r.id, r.invoice_number, r.notes, r.total::text AS total, r.received_at, w.name AS almacen FROM purchase_receipts r JOIN warehouses w ON w.id = r.warehouse_id WHERE r.purchase_order_id = ${id} ORDER BY r.received_at`)).rows as Record<string, string>[];
    return {
      id: o.id, estado: o.status, proveedor: o.proveedor, proveedorId: o.sid, esperadaEl: o.esperada, total: o.total, notas: o.notes, planDelDia: o.plan, creada: new Date(String(o.created_at)).toISOString(),
      lineas: l.map((x) => ({ insumoId: x.ingredient_id, insumo: x.name, unidad: x.unit_code, pedido: x.qty, recibido: x.recibido, pendiente: x.pendiente, costoUnitario: x.costo })),
      recepciones: rc.map((x) => ({ id: x.id, factura: x.invoice_number, notas: x.notes, total: x.total, fecha: new Date(String(x.received_at)).toISOString(), almacen: x.almacen })),
    };
  }

  listar(t: Tenant, estado?: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT o.id, o.status, o.expected_on::text AS esperada, o.total::text AS total, o.created_at, s.name AS proveedor, (SELECT count(*)::int FROM purchase_order_lines l WHERE l.purchase_order_id = o.id) AS lineas
        FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id WHERE o.restaurant_id = ${t.restaurantId} ${estado ? sql`AND o.status = ${estado}` : sql``} ORDER BY o.created_at DESC LIMIT 200`);
      return (r.rows as { id: string; status: string; esperada: string; total: string; created_at: string; proveedor: string; lineas: number }[]).map((o) => ({ id: o.id, estado: o.status, proveedor: o.proveedor, esperadaEl: o.esperada, total: o.total, lineas: o.lineas, creada: new Date(String(o.created_at)).toISOString() }));
    });
  }

  detalle(t: Tenant, id: string) { return this.db.run(t, (tx) => this.vista(tx, t, id)); }

  enviar(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`UPDATE purchase_orders SET status = 'enviada', sent_at = now() WHERE id = ${id} AND restaurant_id = ${t.restaurantId} AND status = 'borrador' RETURNING id`);
      if (!r.rows.length) throw new ConflictException('Solo se envía una orden en borrador.');
      await auditar(tx, t.restaurantId, por, 'compras.orden_enviada', 'purchase_order', id);
      return this.vista(tx, t, id);
    });
  }

  cancelar(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`UPDATE purchase_orders SET status = 'cancelada' WHERE id = ${id} AND restaurant_id = ${t.restaurantId} AND status IN ('borrador','enviada') RETURNING id`);
      if (!r.rows.length) throw new ConflictException('Esa orden ya tiene recepciones o está cerrada: no se puede cancelar.');
      await auditar(tx, t.restaurantId, por, 'compras.orden_cancelada', 'purchase_order', id);
      return this.vista(tx, t, id);
    });
  }

  /**
   * Recibe mercadería contra la orden: entra al kardex (con costo promedio), queda la diferencia entre lo pedido y lo recibido,
   * se registra el precio del proveedor, nace la cuenta por pagar y la orden sigue abierta por el saldo si fue parcial.
   */
  recibir(t: Tenant, por: string, id: string, d: z.infer<typeof Recepcion>) {
    return this.db.run(t, async (tx) => {
      const [o] = (await tx.execute(sql`SELECT status, supplier_id FROM purchase_orders WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows as { status: string; supplier_id: string }[];
      if (!o) throw new NotFoundException('Orden no encontrada.');
      if (!['enviada', 'parcial'].includes(o.status)) throw new ConflictException(o.status === 'borrador' ? 'Primero envía la orden al proveedor.' : 'Esta orden ya está cerrada.');
      const [w] = (await tx.execute(sql`SELECT 1 FROM warehouses WHERE id = ${d.almacenId} AND restaurant_id = ${t.restaurantId}`)).rows;
      if (!w) throw new BadRequestException('El almacén no existe en esta sucursal.');
      if (new Set(d.lineas.map((l) => l.insumoId)).size !== d.lineas.length) throw new BadRequestException('Un insumo solo puede aparecer una vez en la recepción.');
      const recibo = (await tx.execute(sql`INSERT INTO purchase_receipts (restaurant_id, purchase_order_id, warehouse_id, invoice_number, notes, received_by) VALUES (${t.restaurantId}, ${id}, ${d.almacenId}, ${d.factura ?? null}, ${d.notas ?? null}, ${por}::uuid) RETURNING id`)).rows[0] as { id: string };
      const alzas: { insumo: string; anterior: string; nuevo: string; alzaPct: string }[] = [];
      const tocados: string[] = [];
      for (const l of d.lineas) {
        const [ln] = (await tx.execute(sql`SELECT l.qty::text AS qty, l.received_qty::text AS rec, l.unit_cost::text AS costo, i.name FROM purchase_order_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.purchase_order_id = ${id} AND l.ingredient_id = ${l.insumoId}`)).rows as { qty: string; rec: string; costo: string; name: string }[];
        if (!ln) throw new BadRequestException('Uno de los insumos no está en la orden.');
        const costo = l.costoUnitario !== undefined ? l.costoUnitario.toFixed(4) : ln.costo;
        const cant = l.cantidad.toFixed(3);
        const pendiente = (await tx.execute(sql`SELECT GREATEST(${ln.qty}::numeric - ${ln.rec}::numeric, 0)::text AS p`)).rows[0] as { p: string };
        await this.inventario.registrar(tx, t, por, { kind: 'compra', warehouseId: d.almacenId, ingredientId: l.insumoId, qty: cant, unitCost: costo, lot: l.lote ?? null, expires: l.vence ?? null, refType: 'purchase_order', refId: id, groupId: recibo.id });
        await tx.execute(sql`UPDATE purchase_order_lines SET received_qty = received_qty + ${cant}::numeric WHERE purchase_order_id = ${id} AND ingredient_id = ${l.insumoId}`);
        await tx.execute(sql`INSERT INTO purchase_receipt_lines (restaurant_id, receipt_id, ingredient_id, ordered_qty, pending_before, received_qty, unit_cost) VALUES (${t.restaurantId}, ${recibo.id}, ${l.insumoId}, ${ln.qty}::numeric, ${pendiente.p}::numeric, ${cant}::numeric, ${costo}::numeric)`);
        const [prev] = (await tx.execute(sql`SELECT unit_cost::text AS c FROM supplier_prices WHERE restaurant_id = ${t.restaurantId} AND supplier_id = ${o.supplier_id} AND ingredient_id = ${l.insumoId} ORDER BY recorded_at DESC, id DESC LIMIT 1`)).rows as { c: string }[];
        await tx.execute(sql`INSERT INTO supplier_prices (restaurant_id, supplier_id, ingredient_id, unit_cost, purchase_order_id) VALUES (${t.restaurantId}, ${o.supplier_id}, ${l.insumoId}, ${costo}::numeric, ${id})`);
        if (prev && Number(prev.c) > 0) {
          const pct = (await tx.execute(sql`SELECT round((${costo}::numeric - ${prev.c}::numeric) / ${prev.c}::numeric * 100, 2)::text AS p`)).rows[0] as { p: string };
          if (Number(pct.p) > UMBRAL_ALZA_PCT) {
            alzas.push({ insumo: ln.name, anterior: prev.c, nuevo: costo, alzaPct: pct.p });
            await tx.execute(sql`INSERT INTO alerts (restaurant_id, kind, severity, message, data) VALUES (${t.restaurantId}, 'precio_alto', 'media', ${`Alza de precio: ${ln.name} +${pct.p}% (Bs ${Number(prev.c)} → Bs ${Number(costo)})`}, ${JSON.stringify({ insumoId: l.insumoId, proveedorId: o.supplier_id, anterior: prev.c, nuevo: costo, alzaPct: pct.p })}::jsonb)`);
          }
        }
        tocados.push(l.insumoId);
      }
      if (d.conIva) await tx.execute(sql`UPDATE purchase_receipts SET has_iva = true WHERE id = ${recibo.id}`);
      const total = (await tx.execute(sql`UPDATE purchase_receipts SET total = (SELECT COALESCE(SUM(round(received_qty * unit_cost, 2)), 0) FROM purchase_receipt_lines WHERE receipt_id = ${recibo.id}) WHERE id = ${recibo.id} RETURNING total::text AS total`)).rows[0] as { total: string };
      if (Number(total.total) > 0) {
        await tx.execute(sql`INSERT INTO payables_receivables (restaurant_id, direction, counterparty, supplier_id, amount, due_on, purchase_order_id, receipt_id, document_number)
          SELECT ${t.restaurantId}, 'por_pagar', s.name, s.id, ${total.total}::numeric, ${HOY} + s.payment_days, ${id}, ${recibo.id}, ${d.factura ?? null} FROM suppliers s WHERE s.id = ${o.supplier_id}`);
      }
      await this.conta.compraRecibida(tx, t, por, { reciboId: recibo.id, total: total.total, conIva: d.conIva });
      const abierto = (await tx.execute(sql`SELECT count(*)::int AS n FROM purchase_order_lines WHERE purchase_order_id = ${id} AND received_qty < qty`)).rows[0] as { n: number };
      await tx.execute(sql`UPDATE purchase_orders SET status = ${abierto.n === 0 ? 'recibida' : 'parcial'} WHERE id = ${id}`);
      await this.consumo.revisarAlertas(tx, t, tocados);
      await auditar(tx, t.restaurantId, por, 'compras.recepcion', 'purchase_order', id, { recibo: recibo.id, total: total.total, lineas: d.lineas.length });
      return { orden: await this.vista(tx, t, id), totalRecibido: total.total, alertasDePrecio: alzas };
    });
  }

  /* ---------------- sugerencias ---------------- */

  /** Insumos bajo su mínimo: cuánto falta para volver al mínimo, agrupado por proveedor preferido. */
  sugerencias(t: Tenant) {
    return this.db.run(t, async (tx) => this.agrupar(tx, t, await this.bajoMinimo(tx, t)));
  }

  private async bajoMinimo(tx: Bd, t: Tenant): Promise<{ insumoId: string; cantidad: string }[]> {
    const r = await tx.execute(sql`SELECT i.id, (i.min_stock - COALESCE(SUM(s.qty), 0))::numeric(14,3)::text AS falta FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id
      WHERE i.restaurant_id = ${t.restaurantId} AND i.active AND i.min_stock > 0 GROUP BY i.id HAVING COALESCE(SUM(s.qty), 0) < i.min_stock`);
    return (r.rows as { id: string; falta: string }[]).map((x) => ({ insumoId: x.id, cantidad: x.falta }));
  }

  /** Agrupa cantidades necesarias por proveedor preferido; lo que no tiene proveedor se devuelve aparte (no se inventa uno). */
  private async agrupar(tx: Bd, t: Tenant, items: { insumoId: string; cantidad: string }[]) {
    if (!items.length) return { proveedores: [], sinProveedor: [] };
    const ids = items.map((i) => i.insumoId);
    const info = (await tx.execute(sql`SELECT i.id, i.name, i.unit_code, i.last_cost::text AS costo, i.preferred_supplier_id AS sid, s.name AS proveedor, s.lead_days FROM ingredients i LEFT JOIN suppliers s ON s.id = i.preferred_supplier_id AND s.active
      WHERE i.restaurant_id = ${t.restaurantId} AND i.id = ANY(${uuidArray(ids)})`)).rows as { id: string; name: string; unit_code: string; costo: string; sid: string | null; proveedor: string | null; lead_days: number | null }[];
    const grupos = new Map<string, { proveedorId: string; proveedor: string; diasEntrega: number; lineas: { insumoId: string; insumo: string; unidad: string; cantidad: string; costoUnitario: string }[] }>();
    const sin: { insumoId: string; insumo: string; unidad: string; cantidad: string }[] = [];
    for (const it of items) {
      const f = info.find((x) => x.id === it.insumoId); if (!f) continue;
      if (!f.sid || !f.proveedor) { sin.push({ insumoId: f.id, insumo: f.name, unidad: f.unit_code, cantidad: it.cantidad }); continue; }
      const g = grupos.get(f.sid) ?? { proveedorId: f.sid, proveedor: f.proveedor, diasEntrega: f.lead_days ?? 1, lineas: [] };
      g.lineas.push({ insumoId: f.id, insumo: f.name, unidad: f.unit_code, cantidad: it.cantidad, costoUnitario: f.costo }); grupos.set(f.sid, g);
    }
    return { proveedores: [...grupos.values()], sinProveedor: sin };
  }

  /** Crea órdenes en borrador, una por proveedor, respetando sus días de entrega. Si el plan es para antes de que llegue, lo marca. */
  private async ordenesDe(tx: Bd, t: Tenant, por: string, items: { insumoId: string; cantidad: string }[], planDate?: string) {
    const g = await this.agrupar(tx, t, items);
    const creadas: { id: string; proveedor: string; esperadaEl: string; total: string; tarde: boolean; lineas: number }[] = [];
    for (const p of g.proveedores) {
      const id = await this.crearOrden(tx, t, por, { proveedorId: p.proveedorId, planDate, notas: planDate ? `Sugerida por el plan del día ${planDate}` : 'Sugerida por stock mínimo', lineas: p.lineas.map((l) => ({ insumoId: l.insumoId, cantidad: l.cantidad, costoUnitario: l.costoUnitario })) });
      const v = await this.vista(tx, t, id);
      creadas.push({ id, proveedor: p.proveedor, esperadaEl: v.esperadaEl as string, total: v.total as string, tarde: !!planDate && (v.esperadaEl as string) > planDate, lineas: p.lineas.length });
    }
    return { ordenes: creadas, sinProveedor: g.sinProveedor };
  }

  /** Órdenes en borrador, una por proveedor preferido, con los insumos que faltan para un evento. */
  ordenesDeFaltantes(t: Tenant, por: string, items: { insumoId: string; cantidad: string }[]) { return this.db.run(t, (tx) => this.ordenesDe(tx, t, por, items)); }

  ordenesSugeridas(t: Tenant, por: string) { return this.db.run(t, async (tx) => this.ordenesDe(tx, t, por, await this.bajoMinimo(tx, t))); }

  /** Desde el plan del día: una orden en borrador por proveedor con lo que FALTA. */
  ordenesDelPlan(t: Tenant, por: string, fecha: string) {
    return this.db.run(t, async (tx) => {
      const plan = await this.recetas.verPlan(t, fecha).catch(() => null);
      const falta = (plan?.insumos ?? []).filter((i) => !i.alcanza).map((i) => ({ insumoId: i.insumoId, cantidad: i.faltante }));
      if (!falta.length) throw new BadRequestException('Ese plan no tiene faltantes: no hace falta comprar nada.');
      return this.ordenesDe(tx, t, por, falta, fecha);
    });
  }

  /* ---------------- cuentas por pagar ---------------- */

  porPagar(t: Tenant, soloAbiertas = true) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT p.id, p.counterparty, p.amount::text AS monto, p.paid::text AS pagado, (p.amount - p.paid)::text AS saldo, p.due_on::text AS vence, (p.due_on - ${HOY})::int AS dias, p.document_number, p.created_at, p.paid_at
        FROM payables_receivables p WHERE p.restaurant_id = ${t.restaurantId} AND p.direction = 'por_pagar' ${soloAbiertas ? sql`AND p.paid < p.amount` : sql``} ORDER BY p.due_on, p.created_at LIMIT 300`);
      return (r.rows as { id: string; counterparty: string; monto: string; pagado: string; saldo: string; vence: string; dias: number; document_number: string | null }[]).map((x) => ({ id: x.id, proveedor: x.counterparty, monto: x.monto, pagado: x.pagado, saldo: x.saldo, vence: x.vence, dias: x.dias, vencida: x.dias < 0, documento: x.document_number }));
    });
  }

  pagar(t: Tenant, por: string, id: string, d: z.infer<typeof Pago>) {
    return this.db.run(t, async (tx) => {
      const [p] = (await tx.execute(sql`SELECT (amount - paid)::text AS saldo FROM payables_receivables WHERE id = ${id} AND restaurant_id = ${t.restaurantId} AND direction = 'por_pagar' FOR UPDATE`)).rows as { saldo: string }[];
      if (!p) throw new NotFoundException('Cuenta por pagar no encontrada.');
      if (!(Number(p.saldo) > 0)) throw new ConflictException('Esta cuenta ya está pagada.');
      const monto = d.monto !== undefined ? d.monto.toFixed(2) : p.saldo;
      if (Number(monto) > Number(p.saldo)) throw new BadRequestException(`El pago supera el saldo (Bs ${p.saldo}).`);
      const r = (await tx.execute(sql`UPDATE payables_receivables SET paid = paid + ${monto}::numeric, paid_by = ${por}::uuid, paid_at = CASE WHEN paid + ${monto}::numeric >= amount THEN now() ELSE paid_at END WHERE id = ${id} RETURNING (amount - paid)::text AS saldo`)).rows[0] as { saldo: string };
      await this.conta.pagoAProveedor(tx, t, por, monto, d.metodo);
      await auditar(tx, t.restaurantId, por, 'compras.pago_proveedor', 'payable', id, { monto, saldo: r.saldo });
      return { ok: true, saldo: r.saldo };
    });
  }
}
