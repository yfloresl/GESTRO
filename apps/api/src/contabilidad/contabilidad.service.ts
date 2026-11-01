import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import {
  Asiento, ClaveCuenta, PLAN_DE_CUENTAS, cierreDeEvento, cobroDeCuenta, pagoDeEvento, TipoCuenta, ajusteDeInventario, compraAlContado, compraRecibida, costoDeVentas, merma, MetodoCobro,
  pagoAProveedor, saldoNatural, validarPartidaDoble, ventaCobrada,
} from './asientos';

const HOY = sql`(now() AT TIME ZONE 'America/La_Paz')::date`;
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida');
const Monto = z.number().min(0).max(1_000_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');

export const NuevoAsiento = z.object({
  fecha: Fecha, glosa: z.string().trim().min(3).max(200),
  lineas: z.array(z.object({ cuenta: z.string().trim().min(1).max(20), debe: Monto.default(0), haber: Monto.default(0), centroCostoId: z.string().uuid().nullable().optional() }).strict()).min(2).max(60),
}).strict();
export const NuevaCuenta = z.object({
  codigo: z.string().trim().regex(/^\d+(\.\d+)*$/, 'Código con números y puntos, p. ej. 5.2.05').max(20), nombre: z.string().trim().min(2).max(120),
  tipo: z.enum(['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto']), codigoPadre: z.string().trim().max(20).nullable().optional(), aceptaAsientos: z.boolean().default(true),
}).strict();
export const CambioCuenta = z.object({ nombre: z.string().trim().min(2).max(120).optional(), activa: z.boolean().optional() }).strict();
export const NuevoCentro = z.object({ codigo: z.string().trim().min(1).max(20), nombre: z.string().trim().min(2).max(80) }).strict();
export const Rango = z.object({ desde: Fecha.optional(), hasta: Fecha.optional() }).strict();
export const Periodo = z.object({ anio: z.number().int().min(2000).max(2100), mes: z.number().int().min(1).max(12) }).strict();
export const Tasas = z.object({ iva: z.number().min(0).max(100), it: z.number().min(0).max(100) }).strict();

interface Origen { source: string; sourceId: string; fecha?: string }
interface Saldo { id: string; codigo: string; nombre: string; tipo: TipoCuenta; acepta: boolean; clave: string | null; debe: string; haber: string }

/**
 * Contabilidad de nivel medio: asientos de partida doble generados por los hechos del negocio (ventas, consumo, compras, mermas) o
 * escritos a mano, con períodos que se cierran. Un asiento publicado no se edita ni se borra: se contrarresta con otro.
 * Nunca frena una venta ni un movimiento: si un asiento automático falla, el hecho sigue y queda una alerta para corregirlo.
 */
@Injectable()
export class ContabilidadService {
  private readonly log = new Logger('Contabilidad');
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /* ============ plan de cuentas ============ */

  /** Crea el plan de cuentas de la plantilla la primera vez que la sucursal lo necesita. */
  async asegurarPlan(tx: Bd, t: Tenant): Promise<void> {
    const hay = await tx.execute(sql`SELECT 1 FROM chart_of_accounts WHERE restaurant_id = ${t.restaurantId} LIMIT 1`);
    if (hay.rows.length) return;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'plan:' + t.restaurantId}))`);
    if ((await tx.execute(sql`SELECT 1 FROM chart_of_accounts WHERE restaurant_id = ${t.restaurantId} LIMIT 1`)).rows.length) return;
    const ids = new Map<string, string>();
    for (const c of PLAN_DE_CUENTAS) {
      const r = await tx.execute(sql`INSERT INTO chart_of_accounts (restaurant_id, code, name, type, parent_id, accepts_entries, system_key)
        VALUES (${t.restaurantId}, ${c.code}, ${c.name}, ${c.type}::account_type, ${c.parent ? ids.get(c.parent)! : null}::uuid, ${!c.groups}, ${c.key ?? null}) RETURNING id`);
      ids.set(c.code, (r.rows[0] as { id: string }).id);
    }
  }

  private async cuentaDe(tx: Bd, t: Tenant, clave: ClaveCuenta): Promise<string> {
    const r = (await tx.execute(sql`SELECT id FROM chart_of_accounts WHERE restaurant_id = ${t.restaurantId} AND system_key = ${clave} AND active`)).rows[0] as { id: string } | undefined;
    if (!r) throw new ConflictException(`Falta la cuenta del sistema «${clave}» en el plan de cuentas.`);
    return r.id;
  }

  async cuentas(t: Tenant) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t);
      const r = await tx.execute(sql`SELECT a.id, a.code, a.name, a.type::text AS tipo, a.accepts_entries, a.active, a.system_key, p.code AS padre,
          EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id) AS con_movimientos
        FROM chart_of_accounts a LEFT JOIN chart_of_accounts p ON p.id = a.parent_id WHERE a.restaurant_id = ${t.restaurantId} ORDER BY string_to_array(a.code, '.')::int[]`);
      return (r.rows as { id: string; code: string; name: string; tipo: string; accepts_entries: boolean; active: boolean; system_key: string | null; padre: string | null; con_movimientos: boolean }[])
        .map((a) => ({ id: a.id, codigo: a.code, nombre: a.name, tipo: a.tipo, aceptaAsientos: a.accepts_entries, activa: a.active, claveDelSistema: a.system_key, codigoPadre: a.padre, conMovimientos: a.con_movimientos }));
    });
  }

  crearCuenta(t: Tenant, por: string, d: z.infer<typeof NuevaCuenta>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t);
      let padre: string | null = null;
      if (d.codigoPadre) {
        const p = (await tx.execute(sql`SELECT id, type::text AS tipo, accepts_entries FROM chart_of_accounts WHERE restaurant_id = ${t.restaurantId} AND code = ${d.codigoPadre}`)).rows[0] as { id: string; tipo: string; accepts_entries: boolean } | undefined;
        if (!p) throw new BadRequestException('La cuenta padre no existe.');
        if (p.accepts_entries && (await tx.execute(sql`SELECT 1 FROM journal_lines WHERE account_id = ${p.id} LIMIT 1`)).rows.length) throw new ConflictException('La cuenta padre ya tiene movimientos: no puede agrupar otras cuentas.');
        padre = p.id;
        await tx.execute(sql`UPDATE chart_of_accounts SET accepts_entries = false WHERE id = ${p.id}`);
      }
      try {
        const r = await tx.execute(sql`INSERT INTO chart_of_accounts (restaurant_id, code, name, type, parent_id, accepts_entries) VALUES (${t.restaurantId}, ${d.codigo}, ${d.nombre}, ${d.tipo}::account_type, ${padre}::uuid, ${d.aceptaAsientos}) RETURNING id`);
        const id = (r.rows[0] as { id: string }).id;
        await auditar(tx, t.restaurantId, por, 'contabilidad.cuenta_creada', 'account', id, d);
        return { id };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe una cuenta con ese código.'); throw e; }
    });
  }

  cambiarCuenta(t: Tenant, por: string, id: string, d: z.infer<typeof CambioCuenta>) {
    return this.db.run(t, async (tx) => {
      const c = (await tx.execute(sql`SELECT system_key FROM chart_of_accounts WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows[0] as { system_key: string | null } | undefined;
      if (!c) throw new NotFoundException('Cuenta no encontrada.');
      if (d.activa === false && c.system_key) throw new ConflictException('Es una cuenta del sistema (la usan los asientos automáticos): no se puede desactivar.');
      await tx.execute(sql`UPDATE chart_of_accounts SET name = COALESCE(${d.nombre ?? null}, name), active = COALESCE(${d.activa ?? null}::boolean, active) WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'contabilidad.cuenta_cambiada', 'account', id, d);
      return { ok: true };
    });
  }

  centros(t: Tenant) { return this.db.run(t, async (tx) => (await tx.execute(sql`SELECT id, code AS codigo, name AS nombre FROM cost_centers WHERE restaurant_id = ${t.restaurantId} ORDER BY code`)).rows); }
  crearCentro(t: Tenant, por: string, d: z.infer<typeof NuevoCentro>) {
    return this.db.run(t, async (tx) => {
      try {
        const r = await tx.execute(sql`INSERT INTO cost_centers (restaurant_id, code, name) VALUES (${t.restaurantId}, ${d.codigo}, ${d.nombre}) RETURNING id`);
        await auditar(tx, t.restaurantId, por, 'contabilidad.centro_creado', 'cost_center', (r.rows[0] as { id: string }).id, d);
        return { id: (r.rows[0] as { id: string }).id };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un centro de costo con ese código.'); throw e; }
    });
  }

  /* ============ registro de asientos ============ */

  /** Primer día abierto a partir de la fecha pedida: un asiento automático nunca cae en un período cerrado. */
  private async fechaAbierta(tx: Bd, t: Tenant, pedida?: string): Promise<string> {
    let f = (await tx.execute(sql`SELECT COALESCE(${pedida ?? null}::date, ${HOY})::text AS f`)).rows[0] as { f: string };
    for (let i = 0; i < 36; i++) {
      const c = await tx.execute(sql`SELECT 1 FROM fiscal_periods WHERE restaurant_id = ${t.restaurantId} AND closed AND year = EXTRACT(YEAR FROM ${f.f}::date)::int AND month = EXTRACT(MONTH FROM ${f.f}::date)::int`);
      if (!c.rows.length) return f.f;
      f = (await tx.execute(sql`SELECT (date_trunc('month', ${f.f}::date) + interval '1 month')::date::text AS f`)).rows[0] as { f: string };
    }
    throw new ConflictException('No hay un período abierto donde registrar el asiento.');
  }

  private async siguienteNumero(tx: Bd, t: Tenant): Promise<string> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'asiento:' + t.restaurantId}))`);
    return ((await tx.execute(sql`SELECT (GREATEST(COALESCE(MAX(number), 0), 0) + 1)::text AS n FROM journal_entries WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as { n: string }).n;
  }

  private async insertarPublicado(tx: Bd, t: Tenant, por: string | null, a: Asiento, o: { source: string; sourceId: string | null; fecha?: string; reversalOf?: string }): Promise<string> {
    validarPartidaDoble(a);
    const fecha = await this.fechaAbierta(tx, t, o.fecha);
    const numero = await this.siguienteNumero(tx, t);
    const e = (await tx.execute(sql`INSERT INTO journal_entries (restaurant_id, entry_date, number, memo, source, source_id, posted, created_by, reversal_of)
      VALUES (${t.restaurantId}, ${fecha}::date, ${numero}::bigint, ${a.glosa}, ${o.source}, ${o.sourceId}::uuid, false, ${por}::uuid, ${o.reversalOf ?? null}::uuid) RETURNING id`)).rows[0] as { id: string };
    for (const l of a.lineas) {
      await tx.execute(sql`INSERT INTO journal_lines (restaurant_id, entry_id, account_id, debit, credit) VALUES (${t.restaurantId}, ${e.id}, ${await this.cuentaDe(tx, t, l.cuenta)}, ${l.debe}::numeric, ${l.haber}::numeric)`);
    }
    await tx.execute(sql`UPDATE journal_entries SET posted = true, posted_at = now() WHERE id = ${e.id}`);
    return e.id;
  }

  /**
   * Asiento automático de un hecho. Idempotente: un mismo hecho (source + sourceId) genera un solo asiento.
   * Se ejecuta en un punto de guardado y NUNCA propaga el error: deja una alerta para que contabilidad lo revise.
   */
  async registrar(tx: Bd, t: Tenant, por: string | null, a: Asiento | null, o: Origen): Promise<void> {
    if (!a) return;
    try {
      await tx.transaction(async (sp) => {
        const s = sp as unknown as Bd;
        await this.asegurarPlan(s, t);
        const ya = await s.execute(sql`SELECT 1 FROM journal_entries WHERE restaurant_id = ${t.restaurantId} AND source = ${o.source} AND source_id = ${o.sourceId}::uuid AND reversal_of IS NULL`);
        if (ya.rows.length) return;
        await this.insertarPublicado(s, t, por, a, o);
      });
    } catch (e) {
      this.log.error(`No se pudo registrar el asiento «${a.glosa}» (${o.source}/${o.sourceId}): ${(e as Error).message}`);
      try { await tx.execute(sql`INSERT INTO alerts (restaurant_id, kind, severity, message, data) VALUES (${t.restaurantId}, 'contabilidad', 'alta', ${`No se pudo contabilizar: ${a.glosa}`}, ${JSON.stringify({ source: o.source, sourceId: o.sourceId, error: (e as Error).message })}::jsonb)`); } catch { /* sin alerta */ }
    }
  }

  /** Contrarresta el asiento de un hecho (p. ej. una venta anulada). Si el hecho no tenía asiento, no hace nada. */
  async contrarrestarOrigen(tx: Bd, t: Tenant, por: string | null, source: string, sourceId: string, motivo?: string): Promise<void> {
    try {
      await tx.transaction(async (sp) => {
        const s = sp as unknown as Bd;
        const orig = (await s.execute(sql`SELECT e.id, e.memo FROM journal_entries e WHERE e.restaurant_id = ${t.restaurantId} AND e.source = ${source} AND e.source_id = ${sourceId}::uuid AND e.reversal_of IS NULL AND e.posted
          AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of = e.id)`)).rows[0] as { id: string; memo: string } | undefined;
        if (orig) await this.contrarrestarEntrada(s, t, por, orig.id, motivo);
      });
    } catch (e) {
      this.log.error(`No se pudo contrarrestar el asiento (${source}/${sourceId}): ${(e as Error).message}`);
      try { await tx.execute(sql`INSERT INTO alerts (restaurant_id, kind, severity, message, data) VALUES (${t.restaurantId}, 'contabilidad', 'alta', ${'No se pudo contrarrestar el asiento de una anulación'}, ${JSON.stringify({ source, sourceId, error: (e as Error).message })}::jsonb)`); } catch { /* sin alerta */ }
    }
  }

  private async contrarrestarEntrada(tx: Bd, t: Tenant, por: string | null, id: string, motivo?: string): Promise<string> {
    const e = (await tx.execute(sql`SELECT memo, source, source_id::text AS source_id FROM journal_entries WHERE id = ${id} AND restaurant_id = ${t.restaurantId} AND posted AND reversal_of IS NULL`)).rows[0] as { memo: string; source: string; source_id: string | null } | undefined;
    if (!e) throw new NotFoundException('Asiento publicado no encontrado (o ya es una anulación).');
    if ((await tx.execute(sql`SELECT 1 FROM journal_entries WHERE reversal_of = ${id}`)).rows.length) throw new ConflictException('Este asiento ya fue contrarrestado.');
    const ls = (await tx.execute(sql`SELECT a.system_key, l.account_id::text AS account_id, l.debit::text AS debit, l.credit::text AS credit, l.cost_center_id::text AS cc FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE l.entry_id = ${id}`)).rows as { system_key: string | null; account_id: string; debit: string; credit: string; cc: string | null }[];
    const glosa = `Anulación: ${e.memo}${motivo ? ` (${motivo})` : ''}`.slice(0, 200);
    validarPartidaDoble({ glosa, lineas: ls.map((l) => ({ cuenta: 'caja' as ClaveCuenta, debe: l.credit, haber: l.debit })) });
    const fecha = await this.fechaAbierta(tx, t);
    const numero = await this.siguienteNumero(tx, t);
    const n = (await tx.execute(sql`INSERT INTO journal_entries (restaurant_id, entry_date, number, memo, source, source_id, posted, created_by, reversal_of)
      VALUES (${t.restaurantId}, ${fecha}::date, ${numero}::bigint, ${glosa}, ${e.source}, ${e.source_id}::uuid, false, ${por}::uuid, ${id}) RETURNING id`)).rows[0] as { id: string };
    for (const l of ls) await tx.execute(sql`INSERT INTO journal_lines (restaurant_id, entry_id, account_id, cost_center_id, debit, credit) VALUES (${t.restaurantId}, ${n.id}, ${l.account_id}::uuid, ${l.cc}::uuid, ${l.credit}::numeric, ${l.debit}::numeric)`);
    await tx.execute(sql`UPDATE journal_entries SET posted = true, posted_at = now() WHERE id = ${n.id}`);
    return n.id;
  }

  /* ============ ganchos de los hechos del negocio (se llaman dentro de la transacción del hecho) ============ */

  private async tasas(tx: Bd, t: Tenant) {
    const r = (await tx.execute(sql`SELECT iva_pct::text AS iva, it_pct::text AS it FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { iva: string; it: string };
    return { iva: r.iva, it: r.it };
  }

  async ventaCobrada(tx: Bd, t: Tenant, por: string, p: { pagoId: string; total: string; metodo: MetodoCobro; documento: 'factura' | 'recibo' | 'ninguno' }) {
    await this.registrar(tx, t, por, ventaCobrada({ total: p.total, metodo: p.metodo, documento: p.documento, ivaPct: p.documento === 'factura' ? (await this.tasas(tx, t)).iva : 0 }), { source: 'venta', sourceId: p.pagoId });
  }
  ventaAnulada(tx: Bd, t: Tenant, por: string, pagoId: string, motivo: string) { return this.contrarrestarOrigen(tx, t, por, 'venta', pagoId, motivo); }

  /** Costo de lo vendido: valor, al costo promedio, de los insumos consumidos por esos ítems. */
  async costoDeConsumo(tx: Bd, t: Tenant, por: string | null, itemIds: string[]) {
    if (!itemIds.length) return;
    const ids = `{${itemIds.join(',')}}`;
    const v = (await tx.execute(sql`SELECT COALESCE(SUM(-qty * COALESCE(unit_cost, 0)), 0)::numeric(14,2)::text AS v FROM stock_movements WHERE restaurant_id = ${t.restaurantId} AND kind = 'consumo' AND ref_type = 'order_item' AND ref_id = ANY(${ids}::uuid[])`)).rows[0] as { v: string };
    if (Number(v.v) > 0) await this.registrar(tx, t, por, costoDeVentas({ valor: v.v }), { source: 'costo_consumo', sourceId: randomUUID() });
  }

  async compraRecibida(tx: Bd, t: Tenant, por: string, p: { reciboId: string; total: string; conIva: boolean }) {
    await this.registrar(tx, t, por, compraRecibida({ total: p.total, conIva: p.conIva, ivaPct: p.conIva ? (await this.tasas(tx, t)).iva : 0 }), { source: 'compra', sourceId: p.reciboId });
  }
  pagoAProveedor(tx: Bd, t: Tenant, por: string, monto: string, via: 'caja' | 'bancos') { return this.registrar(tx, t, por, pagoAProveedor({ monto, via }), { source: 'pago_proveedor', sourceId: randomUUID() }); }
  cobroDeCuenta(tx: Bd, t: Tenant, por: string, monto: string, via: 'caja' | 'bancos') { return this.registrar(tx, t, por, cobroDeCuenta({ monto, via }), { source: 'cobro_cuenta', sourceId: randomUUID() }); }
  /** Anticipo o saldo cobrado de un evento: queda como anticipo de cliente hasta que el evento se realice. */
  pagoDeEvento(tx: Bd, t: Tenant, por: string, pagoId: string, monto: string, via: 'caja' | 'bancos') { return this.registrar(tx, t, por, pagoDeEvento({ monto, via }), { source: 'evento_pago', sourceId: pagoId }); }
  /** Devolución de un cobro de evento cancelado: contrarresta el asiento del cobro. */
  pagoDeEventoDevuelto(tx: Bd, t: Tenant, por: string, pagoId: string, motivo: string) { return this.contrarrestarOrigen(tx, t, por, 'evento_pago', pagoId, motivo); }
  cierreDeEvento(tx: Bd, t: Tenant, por: string, eventoId: string, total: string, pagado: string) { return this.registrar(tx, t, por, cierreDeEvento({ total, pagado }), { source: 'evento_cierre', sourceId: eventoId }); }
  /** Costo de los insumos que salieron del inventario para un evento (al costo promedio). */
  async costoDeEvento(tx: Bd, t: Tenant, por: string | null, eventoId: string) {
    const v = (await tx.execute(sql`SELECT COALESCE(SUM(-qty * COALESCE(unit_cost, 0)), 0)::numeric(14,2)::text AS v FROM stock_movements WHERE restaurant_id = ${t.restaurantId} AND kind = 'consumo' AND ref_type = 'event' AND ref_id = ${eventoId}::uuid`)).rows[0] as { v: string };
    if (Number(v.v) > 0) await this.registrar(tx, t, por, costoDeVentas({ valor: v.v }), { source: 'costo_evento', sourceId: eventoId });
  }
  compraAlContado(tx: Bd, t: Tenant, por: string, grupoId: string, total: string) { return this.registrar(tx, t, por, compraAlContado({ total }), { source: 'compra_directa', sourceId: grupoId }); }

  /** Valor del kardex de un grupo de movimientos (con signo: entradas suman, salidas restan). */
  private async valorDeGrupo(tx: Bd, t: Tenant, grupoId: string): Promise<string> {
    return ((await tx.execute(sql`SELECT COALESCE(SUM(qty * COALESCE(unit_cost, 0)), 0)::numeric(14,2)::text AS v FROM stock_movements WHERE restaurant_id = ${t.restaurantId} AND group_id = ${grupoId}::uuid`)).rows[0] as { v: string }).v;
  }
  async mermaRegistrada(tx: Bd, t: Tenant, por: string, grupoId: string) {
    const v = new Decimal(await this.valorDeGrupo(tx, t, grupoId)).neg();
    if (v.gt(0)) await this.registrar(tx, t, por, merma({ valor: v.toFixed(2) }), { source: 'merma', sourceId: grupoId });
  }
  async ajusteRegistrado(tx: Bd, t: Tenant, por: string, grupoId: string, valor?: string) {
    await this.registrar(tx, t, por, ajusteDeInventario({ valor: valor ?? (await this.valorDeGrupo(tx, t, grupoId)) }), { source: 'ajuste_inventario', sourceId: grupoId });
  }

  /** Asiento de un movimiento manual del kardex (compra directa, merma o ajuste), agrupado por `groupId`. */
  async deMovimiento(tx: Bd, t: Tenant, por: string, tipo: 'compra' | 'merma' | 'ajuste', grupoId: string) {
    if (tipo === 'merma') return this.mermaRegistrada(tx, t, por, grupoId);
    if (tipo === 'ajuste') return this.ajusteRegistrado(tx, t, por, grupoId);
    const v = await this.valorDeGrupo(tx, t, grupoId);
    if (Number(v) > 0) await this.compraAlContado(tx, t, por, grupoId, v);
  }

  /* ============ asientos manuales ============ */

  private async resolverLineas(tx: Bd, t: Tenant, ls: z.infer<typeof NuevoAsiento>['lineas']) {
    const salida: { cuentaId: string; debe: string; haber: string; cc: string | null }[] = [];
    for (const l of ls) {
      if ((l.debe > 0) === (l.haber > 0)) throw new BadRequestException('Cada línea lleva un monto en el debe o en el haber, no en ambos ni en ninguno.');
      const c = (await tx.execute(sql`SELECT id, accepts_entries, active FROM chart_of_accounts WHERE restaurant_id = ${t.restaurantId} AND code = ${l.cuenta}`)).rows[0] as { id: string; accepts_entries: boolean; active: boolean } | undefined;
      if (!c) throw new BadRequestException(`La cuenta ${l.cuenta} no existe.`);
      if (!c.accepts_entries) throw new BadRequestException(`La cuenta ${l.cuenta} es de agrupación: elige una cuenta de detalle.`);
      if (!c.active) throw new BadRequestException(`La cuenta ${l.cuenta} está desactivada.`);
      if (l.centroCostoId && !(await tx.execute(sql`SELECT 1 FROM cost_centers WHERE id = ${l.centroCostoId} AND restaurant_id = ${t.restaurantId}`)).rows.length) throw new BadRequestException('El centro de costo no existe.');
      salida.push({ cuentaId: c.id, debe: l.debe.toFixed(2), haber: l.haber.toFixed(2), cc: l.centroCostoId ?? null });
    }
    const d = salida.reduce((s, l) => s.plus(l.debe), new Decimal(0)); const h = salida.reduce((s, l) => s.plus(l.haber), new Decimal(0));
    return { lineas: salida, debe: d, haber: h };
  }

  private async escribirBorrador(tx: Bd, t: Tenant, id: string, d: z.infer<typeof NuevoAsiento>) {
    const r = await this.resolverLineas(tx, t, d.lineas);
    await tx.execute(sql`DELETE FROM journal_lines WHERE entry_id = ${id}`);
    for (const l of r.lineas) await tx.execute(sql`INSERT INTO journal_lines (restaurant_id, entry_id, account_id, cost_center_id, debit, credit) VALUES (${t.restaurantId}, ${id}, ${l.cuentaId}::uuid, ${l.cc}::uuid, ${l.debe}::numeric, ${l.haber}::numeric)`);
  }

  crearBorrador(t: Tenant, por: string, d: z.infer<typeof NuevoAsiento>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'asiento:' + t.restaurantId}))`);
      // Los borradores llevan número negativo provisional: el correlativo real se asigna al publicar, sin huecos.
      const n = (await tx.execute(sql`SELECT (COALESCE(MIN(number) FILTER (WHERE number < 0), 0) - 1)::text AS n FROM journal_entries WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as { n: string };
      const e = (await tx.execute(sql`INSERT INTO journal_entries (restaurant_id, entry_date, number, memo, source, posted, created_by) VALUES (${t.restaurantId}, ${d.fecha}::date, ${n.n}::bigint, ${d.glosa}, 'manual', false, ${por}::uuid) RETURNING id`)).rows[0] as { id: string };
      await this.escribirBorrador(tx, t, e.id, d);
      await auditar(tx, t.restaurantId, por, 'contabilidad.borrador_creado', 'journal_entry', e.id, { glosa: d.glosa });
      return { id: e.id };
    });
  }

  private async borrador(tx: Bd, t: Tenant, id: string) {
    const e = (await tx.execute(sql`SELECT posted, source FROM journal_entries WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { posted: boolean; source: string } | undefined;
    if (!e) throw new NotFoundException('Asiento no encontrado.');
    if (e.posted) throw new ConflictException('Un asiento publicado no se edita ni se borra: contrarréstalo con otro asiento.');
    if (e.source !== 'manual') throw new ConflictException('Solo se editan los asientos manuales.');
  }

  cambiarBorrador(t: Tenant, por: string, id: string, d: z.infer<typeof NuevoAsiento>) {
    return this.db.run(t, async (tx) => {
      await this.borrador(tx, t, id);
      await tx.execute(sql`UPDATE journal_entries SET entry_date = ${d.fecha}::date, memo = ${d.glosa} WHERE id = ${id}`);
      await this.escribirBorrador(tx, t, id, d);
      await auditar(tx, t.restaurantId, por, 'contabilidad.borrador_cambiado', 'journal_entry', id, { glosa: d.glosa });
      return { ok: true };
    });
  }

  borrarBorrador(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      await this.borrador(tx, t, id);
      await tx.execute(sql`DELETE FROM journal_entries WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'contabilidad.borrador_borrado', 'journal_entry', id);
      return { ok: true };
    });
  }

  publicar(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      await this.borrador(tx, t, id);
      const s = (await tx.execute(sql`SELECT COALESCE(SUM(debit),0)::text AS d, COALESCE(SUM(credit),0)::text AS h, count(*)::int AS n FROM journal_lines WHERE entry_id = ${id}`)).rows[0] as { d: string; h: string; n: number };
      if (s.n < 2) throw new BadRequestException('El asiento necesita al menos dos líneas.');
      if (!new Decimal(s.d).eq(s.h)) throw new BadRequestException(`El asiento no cuadra: debe ${s.d} ≠ haber ${s.h}.`);
      const fecha = (await tx.execute(sql`SELECT entry_date::text AS f FROM journal_entries WHERE id = ${id}`)).rows[0] as { f: string };
      const cerrado = await tx.execute(sql`SELECT 1 FROM fiscal_periods WHERE restaurant_id = ${t.restaurantId} AND closed AND year = EXTRACT(YEAR FROM ${fecha.f}::date)::int AND month = EXTRACT(MONTH FROM ${fecha.f}::date)::int`);
      if (cerrado.rows.length) throw new ConflictException('Ese período está cerrado: cambia la fecha o reabre el período.');
      const numero = await this.siguienteNumero(tx, t);
      await tx.execute(sql`UPDATE journal_entries SET number = ${numero}::bigint, posted = true, posted_at = now() WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'contabilidad.asiento_publicado', 'journal_entry', id, { numero });
      return { id, numero: Number(numero) };
    });
  }

  contrarrestar(t: Tenant, por: string, id: string, motivo?: string) {
    return this.db.run(t, async (tx) => {
      const nuevo = await this.contrarrestarEntrada(tx, t, por, id, motivo);
      await auditar(tx, t.restaurantId, por, 'contabilidad.asiento_contrarrestado', 'journal_entry', id, { contraasiento: nuevo, motivo });
      return { id: nuevo };
    });
  }

  /* ============ consultas ============ */

  asientos(t: Tenant, f: { desde?: string; hasta?: string; estado?: 'borrador' | 'publicado'; origen?: string }) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT e.id, e.number, e.entry_date::text AS fecha, e.memo, e.source, e.posted, e.reversal_of,
          (SELECT COALESCE(SUM(debit),0)::text FROM journal_lines WHERE entry_id = e.id) AS total,
          EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of = e.id) AS contrarrestado
        FROM journal_entries e WHERE e.restaurant_id = ${t.restaurantId}
          AND (${f.desde ?? null}::date IS NULL OR e.entry_date >= ${f.desde ?? null}::date) AND (${f.hasta ?? null}::date IS NULL OR e.entry_date <= ${f.hasta ?? null}::date)
          AND (${f.estado ?? null}::text IS NULL OR e.posted = (${f.estado ?? null} = 'publicado')) AND (${f.origen ?? null}::text IS NULL OR e.source = ${f.origen ?? null})
        ORDER BY e.entry_date DESC, e.number DESC LIMIT 300`);
      return (r.rows as { id: string; number: string; fecha: string; memo: string; source: string; posted: boolean; reversal_of: string | null; total: string; contrarrestado: boolean }[])
        .map((e) => ({ id: e.id, numero: e.posted ? Number(e.number) : null, fecha: e.fecha, glosa: e.memo, origen: e.source, publicado: e.posted, esAnulacion: !!e.reversal_of, contrarrestado: e.contrarrestado, total: e.total }));
    });
  }

  asiento(t: Tenant, id: string) {
    return this.db.run(t, async (tx) => {
      const e = (await tx.execute(sql`SELECT id, number, entry_date::text AS fecha, memo, source, posted, reversal_of FROM journal_entries WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows[0] as { id: string; number: string; fecha: string; memo: string; source: string; posted: boolean; reversal_of: string | null } | undefined;
      if (!e) throw new NotFoundException('Asiento no encontrado.');
      const ls = (await tx.execute(sql`SELECT a.code, a.name, l.debit::text AS debe, l.credit::text AS haber, l.cost_center_id, c.code AS cc FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id LEFT JOIN cost_centers c ON c.id = l.cost_center_id WHERE l.entry_id = ${id} ORDER BY l.debit DESC, a.code`)).rows as { code: string; name: string; debe: string; haber: string; cost_center_id: string | null; cc: string | null }[];
      return { id: e.id, numero: e.posted ? Number(e.number) : null, fecha: e.fecha, glosa: e.memo, origen: e.source, publicado: e.posted, anulaA: e.reversal_of, lineas: ls.map((l) => ({ cuenta: l.code, nombre: l.name, debe: l.debe, haber: l.haber, centroCostoId: l.cost_center_id, centroCosto: l.cc })) };
    });
  }

  /* ============ reportes ============ */

  private async saldos(tx: Bd, t: Tenant, desde: string | undefined, hasta: string): Promise<Saldo[]> {
    const r = await tx.execute(sql`SELECT a.id, a.code AS codigo, a.name AS nombre, a.type::text AS tipo, a.accepts_entries AS acepta, a.system_key AS clave, COALESCE(s.d, 0)::text AS debe, COALESCE(s.c, 0)::text AS haber
      FROM chart_of_accounts a LEFT JOIN (
        SELECT l.account_id, SUM(l.debit) AS d, SUM(l.credit) AS c FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.restaurant_id = ${t.restaurantId} AND e.posted AND e.entry_date >= ${desde ?? '0001-01-01'}::date AND e.entry_date <= ${hasta}::date GROUP BY l.account_id) s ON s.account_id = a.id
      WHERE a.restaurant_id = ${t.restaurantId} ORDER BY string_to_array(a.code, '.')::int[]`);
    return r.rows as unknown as Saldo[];
  }

  /** Saldo natural de cada cuenta; las cuentas de agrupación suman a todas las que cuelgan de ellas. */
  private arbol(ss: Saldo[]) {
    return ss.map((s) => {
      const hijas = ss.filter((x) => x.codigo === s.codigo || x.codigo.startsWith(`${s.codigo}.`));
      const d = hijas.filter((h) => h.acepta).reduce((a, h) => a.plus(h.debe), new Decimal(0)); const h = hijas.filter((x) => x.acepta).reduce((a, x) => a.plus(x.haber), new Decimal(0));
      return { codigo: s.codigo, nombre: s.nombre, tipo: s.tipo, nivel: s.codigo.split('.').length, detalle: s.acepta, debe: d.toFixed(2), haber: h.toFixed(2), saldo: saldoNatural(s.tipo, d, h).toFixed(2) };
    });
  }

  private rango(r: z.infer<typeof Rango>) { return { desde: r.desde, hasta: r.hasta ?? new Date().toISOString().slice(0, 10) }; }

  comprobacion(t: Tenant, r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t); const { desde, hasta } = this.rango(r);
      const filas = this.arbol(await this.saldos(tx, t, desde, hasta)).filter((f) => f.detalle && (Number(f.debe) !== 0 || Number(f.haber) !== 0));
      const td = filas.reduce((a, f) => a.plus(f.debe), new Decimal(0)); const th = filas.reduce((a, f) => a.plus(f.haber), new Decimal(0));
      return { desde: desde ?? null, hasta, filas: filas.map((f) => { const n = new Decimal(f.debe).minus(f.haber); return { codigo: f.codigo, nombre: f.nombre, debe: f.debe, haber: f.haber, deudor: n.gt(0) ? n.toFixed(2) : '0.00', acreedor: n.lt(0) ? n.abs().toFixed(2) : '0.00' }; }), totalDebe: td.toFixed(2), totalHaber: th.toFixed(2), cuadra: td.eq(th) };
    });
  }

  estadoDeResultados(t: Tenant, r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t); const { desde, hasta } = this.rango(r);
      const a = this.arbol(await this.saldos(tx, t, desde, hasta)).filter((f) => ['ingreso', 'costo', 'gasto'].includes(f.tipo) && (f.nivel > 1 || !f.detalle) && (Number(f.debe) !== 0 || Number(f.haber) !== 0));
      const suma = (tipo: string) => a.filter((f) => f.tipo === tipo && f.detalle).reduce((s, f) => s.plus(f.saldo), new Decimal(0));
      const ing = suma('ingreso'); const cos = suma('costo'); const gas = suma('gasto');
      return {
        desde: desde ?? null, hasta, cuentas: a.filter((f) => f.detalle).map((f) => ({ codigo: f.codigo, nombre: f.nombre, tipo: f.tipo, saldo: f.saldo })),
        ingresos: ing.toFixed(2), costos: cos.toFixed(2), utilidadBruta: ing.minus(cos).toFixed(2), gastos: gas.toFixed(2), resultado: ing.minus(cos).minus(gas).toFixed(2),
        margenBrutoPct: ing.gt(0) ? ing.minus(cos).div(ing).mul(100).toFixed(2) : null,
      };
    });
  }

  balanceGeneral(t: Tenant, r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t); const hasta = this.rango(r).hasta;
      const a = this.arbol(await this.saldos(tx, t, undefined, hasta));
      const detalle = (tipo: string) => a.filter((f) => f.tipo === tipo && f.detalle && Number(f.saldo) !== 0).map((f) => ({ codigo: f.codigo, nombre: f.nombre, saldo: f.saldo }));
      const tot = (tipo: string) => a.filter((f) => f.tipo === tipo && f.detalle).reduce((s, f) => s.plus(f.saldo), new Decimal(0));
      const resultado = tot('ingreso').minus(tot('costo')).minus(tot('gasto'));
      const activo = tot('activo'); const pasivo = tot('pasivo'); const patrimonio = tot('patrimonio').plus(resultado);
      return { hasta, activo: detalle('activo'), pasivo: detalle('pasivo'), patrimonio: detalle('patrimonio'), resultadoDelEjercicio: resultado.toFixed(2),
        totalActivo: activo.toFixed(2), totalPasivo: pasivo.toFixed(2), totalPatrimonio: patrimonio.toFixed(2), cuadra: activo.eq(pasivo.plus(patrimonio)) };
    });
  }

  libroMayor(t: Tenant, codigo: string, r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      const { desde, hasta } = this.rango(r);
      const c = (await tx.execute(sql`SELECT id, name, type::text AS tipo FROM chart_of_accounts WHERE restaurant_id = ${t.restaurantId} AND code = ${codigo}`)).rows[0] as { id: string; name: string; tipo: TipoCuenta } | undefined;
      if (!c) throw new NotFoundException('Cuenta no encontrada.');
      const ini = (await tx.execute(sql`SELECT COALESCE(SUM(l.debit),0)::text AS d, COALESCE(SUM(l.credit),0)::text AS h FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = ${c.id} AND e.posted AND e.entry_date < ${desde ?? '0001-01-01'}::date`)).rows[0] as { d: string; h: string };
      const ls = (await tx.execute(sql`SELECT e.id, e.number, e.entry_date::text AS fecha, e.memo, l.debit::text AS debe, l.credit::text AS haber FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = ${c.id} AND e.posted AND e.entry_date >= ${desde ?? '0001-01-01'}::date AND e.entry_date <= ${hasta}::date ORDER BY e.entry_date, e.number, l.debit DESC LIMIT 2000`)).rows as { id: string; number: string; fecha: string; memo: string; debe: string; haber: string }[];
      let acum = saldoNatural(c.tipo, ini.d, ini.h);
      const saldoInicial = acum.toFixed(2);
      const movimientos = ls.map((l) => { acum = acum.plus(saldoNatural(c.tipo, l.debe, l.haber)); return { asientoId: l.id, numero: Number(l.number), fecha: l.fecha, glosa: l.memo, debe: l.debe, haber: l.haber, saldo: acum.toFixed(2) }; });
      return { codigo, nombre: c.name, tipo: c.tipo, desde: desde ?? null, hasta, saldoInicial, movimientos, saldoFinal: acum.toFixed(2) };
    });
  }

  /** Libro mayor de TODAS las cuentas con saldo inicial o movimiento en el periodo, ordenadas por código. */
  async libroMayorGeneral(t: Tenant, r: z.infer<typeof Rango>) {
    const { desde, hasta } = this.rango(r);
    const codigos = await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT DISTINCT a.code FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
      WHERE e.restaurant_id = ${t.restaurantId} AND e.posted AND e.entry_date <= ${hasta}::date ORDER BY a.code`)).rows.map((x) => (x as { code: string }).code));
    const cuentas = [];
    for (const c of codigos) { const m = await this.libroMayor(t, c, r); if (m.movimientos.length || Number(m.saldoInicial) !== 0) cuentas.push(m); }
    return { desde: desde ?? null, hasta, cuentas };
  }

  flujoDeCaja(t: Tenant, r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t); const { desde, hasta } = this.rango(r);
      const base = sql`FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id WHERE e.restaurant_id = ${t.restaurantId} AND e.posted AND a.system_key IN ('caja','bancos')`;
      const ini = (await tx.execute(sql`SELECT COALESCE(SUM(l.debit - l.credit),0)::text AS s ${base} AND e.entry_date < ${desde ?? '0001-01-01'}::date`)).rows[0] as { s: string };
      const mov = (await tx.execute(sql`SELECT e.source, COALESCE(SUM(l.debit),0)::text AS entra, COALESCE(SUM(l.credit),0)::text AS sale ${base} AND e.entry_date >= ${desde ?? '0001-01-01'}::date AND e.entry_date <= ${hasta}::date GROUP BY e.source ORDER BY e.source`)).rows as { source: string; entra: string; sale: string }[];
      const entradas = mov.reduce((s, m) => s.plus(m.entra), new Decimal(0)); const salidas = mov.reduce((s, m) => s.plus(m.sale), new Decimal(0));
      return { desde: desde ?? null, hasta, saldoInicial: ini.s, porOrigen: mov.map((m) => ({ origen: m.source, entradas: m.entra, salidas: m.sale })), entradas: entradas.toFixed(2), salidas: salidas.toFixed(2), saldoFinal: new Decimal(ini.s).plus(entradas).minus(salidas).toFixed(2) };
    });
  }

  /** Libro de ventas (débito fiscal) o de compras (crédito fiscal) del IVA, armado desde los asientos. */
  libroIva(t: Tenant, tipo: 'ventas' | 'compras', r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t); const { desde, hasta } = this.rango(r);
      const clave = tipo === 'ventas' ? 'debito_fiscal' : 'credito_fiscal';
      const rows = (await tx.execute(sql`SELECT e.id, e.number, e.entry_date::text AS fecha, e.memo, e.source, e.source_id::text AS sid,
          (CASE WHEN ${tipo} = 'ventas' THEN l.credit - l.debit ELSE l.debit - l.credit END)::text AS iva,
          (SELECT COALESCE(SUM(x.debit),0) FROM journal_lines x WHERE x.entry_id = e.id)::text AS total,
          pr.invoice_number AS factura, s.name AS proveedor
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN chart_of_accounts a ON a.id = l.account_id
          LEFT JOIN purchase_receipts pr ON ${tipo} = 'compras' AND e.source = 'compra' AND pr.id = e.source_id LEFT JOIN purchase_orders po ON po.id = pr.purchase_order_id LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE e.restaurant_id = ${t.restaurantId} AND e.posted AND a.system_key = ${clave} AND e.entry_date >= ${desde ?? '0001-01-01'}::date AND e.entry_date <= ${hasta}::date ORDER BY e.entry_date, e.number`)).rows as { id: string; number: string; fecha: string; memo: string; iva: string; total: string; factura: string | null; proveedor: string | null }[];
      const filas = rows.map((x) => ({ asientoId: x.id, numero: Number(x.number), fecha: x.fecha, glosa: x.memo, factura: x.factura, proveedor: x.proveedor, importe: x.total, iva: x.iva }));
      return { tipo, desde: desde ?? null, hasta, filas, totalIva: filas.reduce((s, f) => s.plus(f.iva), new Decimal(0)).toFixed(2), nota: 'Armado desde los asientos. La factura electrónica del SIN todavía no se emite desde GESTRO: el libro de ventas queda en cero hasta entonces.' };
    });
  }

  /** IVA e IT del período. Referencial: las tasas son parámetros de la sucursal y la cifra final la valida el contador. */
  impuestos(t: Tenant, r: z.infer<typeof Rango>) {
    return this.db.run(t, async (tx) => {
      await this.asegurarPlan(tx, t); const { desde, hasta } = this.rango(r);
      const ss = await this.saldos(tx, t, desde, hasta); const tasa = await this.tasas(tx, t);
      const nat = (k: string) => { const s = ss.find((x) => x.clave === k); return s ? saldoNatural(s.tipo, s.debe, s.haber) : new Decimal(0); };
      const deb = nat('debito_fiscal'); const cre = nat('credito_fiscal'); const ventas = nat('ventas');
      const itBase = ventas.plus(deb);
      return { desde: desde ?? null, hasta, tasaIva: tasa.iva, tasaIt: tasa.it, debitoFiscal: deb.toFixed(2), creditoFiscal: cre.toFixed(2), ivaAPagar: deb.minus(cre).toFixed(2), baseIt: itBase.toFixed(2), itDelPeriodo: itBase.mul(tasa.it).div(100).toFixed(2), referencial: true };
    });
  }

  tasasDeImpuestos(t: Tenant) { return this.db.run(t, async (tx) => { const x = await this.tasas(tx, t); return { iva: Number(x.iva), it: Number(x.it) }; }); }
  cambiarTasas(t: Tenant, por: string, d: z.infer<typeof Tasas>) {
    return this.db.run(t, async (tx) => {
      await tx.execute(sql`UPDATE restaurants SET iva_pct = ${d.iva.toFixed(2)}::numeric, it_pct = ${d.it.toFixed(2)}::numeric WHERE id = ${t.restaurantId}`);
      await auditar(tx, t.restaurantId, por, 'contabilidad.tasas', 'restaurant', t.restaurantId, d);
      return { ok: true };
    });
  }

  /* ============ períodos ============ */

  periodos(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT m.y, m.m, COALESCE(p.closed, false) AS cerrado, p.closed_at, m.n FROM (
          SELECT EXTRACT(YEAR FROM entry_date)::int AS y, EXTRACT(MONTH FROM entry_date)::int AS m, count(*)::int AS n FROM journal_entries WHERE restaurant_id = ${t.restaurantId} GROUP BY 1, 2
          UNION SELECT year, month, 0 FROM fiscal_periods WHERE restaurant_id = ${t.restaurantId}) m
        LEFT JOIN fiscal_periods p ON p.restaurant_id = ${t.restaurantId} AND p.year = m.y AND p.month = m.m ORDER BY m.y DESC, m.m DESC`);
      const mapa = new Map<string, { anio: number; mes: number; cerrado: boolean; cerradoEl: string | null; asientos: number }>();
      for (const x of r.rows as { y: number; m: number; cerrado: boolean; closed_at: Date | null; n: number }[]) {
        const k = `${x.y}-${x.m}`; const a = mapa.get(k);
        mapa.set(k, { anio: x.y, mes: x.m, cerrado: x.cerrado, cerradoEl: x.closed_at ? new Date(x.closed_at).toISOString() : null, asientos: (a?.asientos ?? 0) + x.n });
      }
      return [...mapa.values()];
    });
  }

  cerrarPeriodo(t: Tenant, por: string, d: z.infer<typeof Periodo>) {
    return this.db.run(t, async (tx) => {
      const b = (await tx.execute(sql`SELECT count(*)::int AS n FROM journal_entries WHERE restaurant_id = ${t.restaurantId} AND NOT posted AND EXTRACT(YEAR FROM entry_date)::int = ${d.anio} AND EXTRACT(MONTH FROM entry_date)::int = ${d.mes}`)).rows[0] as { n: number };
      if (b.n > 0) throw new ConflictException(`Hay ${b.n} asiento(s) en borrador en ese mes: publícalos o bórralos antes de cerrar.`);
      await tx.execute(sql`INSERT INTO fiscal_periods (restaurant_id, year, month, closed, closed_at, closed_by) VALUES (${t.restaurantId}, ${d.anio}, ${d.mes}, true, now(), ${por}::uuid)
        ON CONFLICT (restaurant_id, year, month) DO UPDATE SET closed = true, closed_at = now(), closed_by = ${por}::uuid`);
      await auditar(tx, t.restaurantId, por, 'contabilidad.periodo_cerrado', 'fiscal_period', `${d.anio}-${d.mes}`, d);
      return { ok: true };
    });
  }

  reabrirPeriodo(t: Tenant, por: string, roles: string[], d: z.infer<typeof Periodo>) {
    if (!roles.includes('owner')) throw new ForbiddenException('Solo el dueño puede reabrir un período cerrado.');
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`UPDATE fiscal_periods SET closed = false, closed_at = NULL, closed_by = NULL WHERE restaurant_id = ${t.restaurantId} AND year = ${d.anio} AND month = ${d.mes} AND closed RETURNING id`);
      if (!r.rows.length) throw new NotFoundException('Ese período no está cerrado.');
      await auditar(tx, t.restaurantId, por, 'contabilidad.periodo_reabierto', 'fiscal_period', `${d.anio}-${d.mes}`, d);
      return { ok: true };
    });
  }
}
