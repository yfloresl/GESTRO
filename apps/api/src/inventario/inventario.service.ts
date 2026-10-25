import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { ContabilidadService } from '../contabilidad/contabilidad.service';
import { ingredients, warehouses } from '../database/esquema';

const Cant = z.number().positive().max(1_000_000).refine((n) => Math.round(n * 1000) / 1000 === n, 'Máximo 3 decimales');
const Costo = z.number().min(0).max(1_000_000).refine((n) => Math.round(n * 10000) / 10000 === n, 'Máximo 4 decimales');
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Insumo = z.object({
  nombre: z.string().trim().min(1).max(120), categoria: z.string().trim().max(60).nullable().optional(), unidad: z.string().trim().min(1).max(10),
  minimo: z.number().min(0).max(1_000_000).default(0), perecedero: z.boolean().default(false), metodoCosto: z.enum(['promedio', 'ultimo']).default('promedio'), activo: z.boolean().default(true),
  proveedorPreferidoId: z.string().uuid().nullable().optional(), almacenConsumoId: z.string().uuid().nullable().optional(),
}).strict();
export const Almacen = z.object({ nombre: z.string().trim().min(1).max(60) }).strict();
export const Movimiento = z.object({
  tipo: z.enum(['compra', 'merma', 'ajuste']), almacenId: z.string().uuid(), insumoId: z.string().uuid(), cantidad: Cant, unidad: z.string().trim().max(10).optional(),
  sentido: z.enum(['entrada', 'salida']).optional(), costoUnitario: Costo.optional(), lote: z.string().trim().min(1).max(40).optional(), vence: Fecha.optional(), motivo: z.string().trim().min(3).max(200).optional(),
}).strict();
export const Traspaso = z.object({ origenId: z.string().uuid(), destinoId: z.string().uuid(), insumoId: z.string().uuid(), cantidad: Cant, unidad: z.string().trim().max(10).optional() }).strict();
export const Conteo = z.object({ almacenId: z.string().uuid(), motivo: z.string().trim().max(160).optional(), lineas: z.array(z.object({ insumoId: z.string().uuid(), contado: z.number().min(0).max(1_000_000).refine((n) => Math.round(n * 1000) / 1000 === n, 'Máximo 3 decimales') }).strict()).min(1).max(500) }).strict();

export interface Mov { kind: 'compra' | 'consumo' | 'merma' | 'ajuste' | 'traspaso_in' | 'traspaso_out' | 'produccion'; warehouseId: string; ingredientId: string; qty: string; unitCost?: string | null; lot?: string | null; expires?: string | null; reason?: string | null; refType?: string | null; refId?: string | null; groupId?: string | null }

@Injectable()
export class InventarioService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb, @Inject(ContabilidadService) private readonly conta: ContabilidadService) {}

  unidades() { return this.db.run({ restaurantId: '', restaurantIds: [] }, (tx) => tx.execute(sql`SELECT code, base_code, factor_to_base::float8 AS factor FROM units ORDER BY base_code, factor_to_base`).then((r) => (r.rows as { code: string; base_code: string; factor: number }[]).map((u) => ({ codigo: u.code, base: u.base_code, factor: u.factor })))); }

  /* ---------------- insumos y almacenes ---------------- */

  insumos(t: Tenant, soloActivos = false) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT i.id, i.name, i.category, i.unit_code, i.min_stock::float8 AS minimo, i.last_cost::text AS ultimo_costo, i.perishable, i.cost_method, i.active, i.preferred_supplier_id, i.default_warehouse_id,
          COALESCE(SUM(s.qty), 0)::numeric(14,3)::text AS stock, COALESCE(SUM(s.qty * s.avg_cost), 0)::numeric(14,2)::text AS valor,
          CASE WHEN COALESCE(SUM(s.qty * s.avg_cost) / NULLIF(SUM(s.qty), 0), 0) > 0 THEN round(SUM(s.qty * s.avg_cost) / NULLIF(SUM(s.qty), 0), 4)::text ELSE i.last_cost::text END AS costo_promedio
        FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id WHERE i.restaurant_id = ${t.restaurantId} ${soloActivos ? sql`AND i.active` : sql``} GROUP BY i.id ORDER BY i.name`);
      return (r.rows as Record<string, unknown>[]).map((x) => {
        const stock = Number(x.stock); const min = Number(x.minimo);
        return {
          id: x.id, nombre: x.name, categoria: x.category, unidad: x.unit_code, minimo: min, ultimoCosto: x.ultimo_costo, costoPromedio: x.costo_promedio, perecedero: x.perishable, metodoCosto: x.cost_method, activo: x.active, proveedorPreferidoId: x.preferred_supplier_id, almacenConsumoId: x.default_warehouse_id,
          stock: x.stock, valor: x.valor, estado: stock <= 0 ? 'agotado' : min > 0 && stock < min ? 'bajo' : 'optimo',
        };
      });
    });
  }

  crearInsumo(t: Tenant, por: string, d: z.infer<typeof Insumo>) {
    return this.db.run(t, async (tx) => {
      await this.unidadValida(tx, d.unidad);
      try {
        const [i] = await tx.insert(ingredients).values({ restaurantId: t.restaurantId, name: d.nombre, category: d.categoria ?? null, unitCode: d.unidad, minStock: d.minimo.toFixed(3), perishable: d.perecedero, costMethod: d.metodoCosto, active: d.activo }).returning({ id: ingredients.id });
        await this.preferencias(tx, t, i.id, d);
        await auditar(tx, t.restaurantId, por, 'inventario.insumo_creado', 'ingredient', i.id, d);
        return { id: i.id };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un insumo con ese nombre.'); throw e; }
    });
  }

  /** Proveedor preferido y almacén de consumo: deben ser de esta sucursal. */
  private async validarPreferencias(tx: Bd, t: Tenant, d: z.infer<typeof Insumo>) {
    if (d.proveedorPreferidoId) { const [p] = (await tx.execute(sql`SELECT 1 FROM suppliers WHERE id = ${d.proveedorPreferidoId} AND restaurant_id = ${t.restaurantId}`)).rows; if (!p) throw new BadRequestException('El proveedor no existe en esta sucursal.'); }
    if (d.almacenConsumoId) { const [p] = (await tx.execute(sql`SELECT 1 FROM warehouses WHERE id = ${d.almacenConsumoId} AND restaurant_id = ${t.restaurantId}`)).rows; if (!p) throw new BadRequestException('El almacén no existe en esta sucursal.'); }
  }
  private async preferencias(tx: Bd, t: Tenant, id: string, d: z.infer<typeof Insumo>) {
    await this.validarPreferencias(tx, t, d);
    if (d.proveedorPreferidoId !== undefined || d.almacenConsumoId !== undefined) {
      await tx.execute(sql`UPDATE ingredients SET preferred_supplier_id = CASE WHEN ${d.proveedorPreferidoId !== undefined} THEN ${d.proveedorPreferidoId ?? null}::uuid ELSE preferred_supplier_id END,
        default_warehouse_id = CASE WHEN ${d.almacenConsumoId !== undefined} THEN ${d.almacenConsumoId ?? null}::uuid ELSE default_warehouse_id END WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`);
    }
  }

  private async unidadValida(tx: Bd, code: string) {
    const r = await tx.execute(sql`SELECT 1 FROM units WHERE code = ${code}`);
    if (!r.rows.length) throw new BadRequestException(`La unidad «${code}» no existe.`);
  }

  cambiarInsumo(t: Tenant, por: string, id: string, d: z.infer<typeof Insumo>) {
    return this.db.run(t, async (tx) => {
      await this.unidadValida(tx, d.unidad);
      const [antes] = await tx.select({ u: ingredients.unitCode }).from(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.restaurantId, t.restaurantId)));
      if (!antes) throw new NotFoundException('Insumo no encontrado.');
      if (antes.u !== d.unidad) {
        const mov = await tx.execute(sql`SELECT 1 FROM stock_movements WHERE ingredient_id = ${id} LIMIT 1`);
        if (mov.rows.length) throw new ConflictException('El insumo ya tiene movimientos: no se puede cambiar su unidad.');
      }
      if (!d.activo) {
        const enReceta = await tx.execute(sql`SELECT 1 FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id WHERE l.ingredient_id = ${id} AND r.active LIMIT 1`);
        if (enReceta.rows.length) throw new ConflictException('Este insumo se usa en una receta activa: quítalo de la receta antes de desactivarlo.');
      }
      await this.validarPreferencias(tx, t, d);
      try {
        await tx.update(ingredients).set({ name: d.nombre, category: d.categoria ?? null, unitCode: d.unidad, minStock: d.minimo.toFixed(3), perishable: d.perecedero, costMethod: d.metodoCosto, active: d.activo }).where(eq(ingredients.id, id));
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un insumo con ese nombre.'); throw e; }
      await this.preferencias(tx, t, id, d);
      await auditar(tx, t.restaurantId, por, 'inventario.insumo_cambiado', 'ingredient', id, d);
      return { ok: true };
    });
  }

  /** Un insumo con movimientos o usado en una receta no se borra: se desactiva (el historial del kardex se conserva). */
  borrarInsumo(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const uso = await tx.execute(sql`SELECT (EXISTS (SELECT 1 FROM stock_movements WHERE ingredient_id = ${id}) OR EXISTS (SELECT 1 FROM recipe_lines WHERE ingredient_id = ${id})) AS usado`);
      if ((uso.rows[0] as { usado: boolean }).usado) throw new ConflictException('Este insumo ya tiene historial o está en una receta: desactívalo en vez de borrarlo.');
      const r = await tx.delete(ingredients).where(and(eq(ingredients.id, id), eq(ingredients.restaurantId, t.restaurantId))).returning({ id: ingredients.id });
      if (!r.length) throw new NotFoundException('Insumo no encontrado.');
      await auditar(tx, t.restaurantId, por, 'inventario.insumo_borrado', 'ingredient', id);
      return { ok: true };
    });
  }

  almacenes(t: Tenant) { return this.db.run(t, (tx) => tx.select().from(warehouses).where(eq(warehouses.restaurantId, t.restaurantId)).orderBy(asc(warehouses.name)).then((r) => r.map((w) => ({ id: w.id, nombre: w.name })))); }
  crearAlmacen(t: Tenant, por: string, d: z.infer<typeof Almacen>) {
    return this.db.run(t, async (tx) => {
      try { const [w] = await tx.insert(warehouses).values({ restaurantId: t.restaurantId, name: d.nombre }).returning({ id: warehouses.id }); await auditar(tx, t.restaurantId, por, 'inventario.almacen_creado', 'warehouse', w.id, d); return { id: w.id }; }
      catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un almacén con ese nombre.'); throw e; }
    });
  }
  cambiarAlmacen(t: Tenant, por: string, id: string, d: z.infer<typeof Almacen>) {
    return this.db.run(t, async (tx) => {
      try { const r = await tx.update(warehouses).set({ name: d.nombre }).where(and(eq(warehouses.id, id), eq(warehouses.restaurantId, t.restaurantId))).returning({ id: warehouses.id }); if (!r.length) throw new NotFoundException('Almacén no encontrado.'); }
      catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un almacén con ese nombre.'); throw e; }
      await auditar(tx, t.restaurantId, por, 'inventario.almacen_cambiado', 'warehouse', id, d);
      return { ok: true };
    });
  }

  /* ---------------- movimientos (única vía para cambiar el stock) ---------------- */

  /** Pasa una cantidad a la unidad del insumo (kg, g, lb entre sí; l y ml entre sí). Todo en NUMERIC dentro de la base. */
  async aUnidadDelInsumo(tx: Bd, t: Tenant, insumoId: string, cantidad: number, unidad?: string, costo?: number): Promise<{ qty: string; costo: string | null; unidadInsumo: string }> {
    const r = await tx.execute(sql`SELECT i.unit_code, round((${cantidad.toFixed(3)}::numeric * COALESCE(u.factor_to_base, b.factor_to_base) / b.factor_to_base), 3)::text AS q,
        CASE WHEN ${costo === undefined ? null : costo.toFixed(4)}::numeric IS NULL THEN NULL ELSE round(${costo === undefined ? 0 : costo.toFixed(4)}::numeric * b.factor_to_base / COALESCE(u.factor_to_base, b.factor_to_base), 4)::text END AS c,
        (u.code IS NULL OR u.base_code = b.base_code) AS compatible
      FROM ingredients i JOIN units b ON b.code = i.unit_code LEFT JOIN units u ON u.code = ${unidad ?? null}
      WHERE i.id = ${insumoId} AND i.restaurant_id = ${t.restaurantId} AND i.active`);
    const f = r.rows[0] as { unit_code: string; q: string; c: string | null; compatible: boolean } | undefined;
    if (!f) throw new NotFoundException('El insumo no existe o está desactivado.');
    if (unidad && !f.compatible) throw new BadRequestException(`La unidad «${unidad}» no se puede convertir a ${f.unit_code}.`);
    if (unidad && (await tx.execute(sql`SELECT 1 FROM units WHERE code = ${unidad}`)).rows.length === 0) throw new BadRequestException(`La unidad «${unidad}» no existe.`);
    if (Number(f.q) <= 0) throw new BadRequestException('La cantidad convertida es demasiado pequeña.');
    return { qty: f.q, costo: f.c, unidadInsumo: f.unit_code };
  }

  private async almacenValido(tx: Bd, t: Tenant, id: string) {
    const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, id), eq(warehouses.restaurantId, t.restaurantId)));
    if (!w) throw new BadRequestException('El almacén no existe en esta sucursal.');
  }

  /** Inserta un movimiento del kardex; el disparador de la base actualiza el nivel y el costo promedio. */
  async registrar(tx: Bd, t: Tenant, por: string | null, m: Mov): Promise<number> {
    const r = await tx.execute(sql`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, unit_cost, lot, expires_on, reason, ref_type, ref_id, group_id, created_by)
      VALUES (${t.restaurantId}, ${m.warehouseId}, ${m.ingredientId}, ${m.kind}, ${m.qty}::numeric, ${m.unitCost ?? null}::numeric, ${m.lot ?? null}, ${m.expires ?? null}::date, ${m.reason ?? null}, ${m.refType ?? null}, ${m.refId ?? null}::uuid, ${m.groupId ?? null}::uuid, ${por}::uuid) RETURNING id`);
    return Number((r.rows[0] as { id: string }).id);
  }

  /**
   * Salida con «primero en vencer, primero en salir»: consume de los lotes con saldo según su vencimiento y el resto,
   * sin lote. El stock puede quedar en negativo (el stock real casi siempre difiere del sistema): eso genera alerta, no bloqueo.
   */
  async salidaFefo(tx: Bd, t: Tenant, por: string | null, base: Omit<Mov, 'qty' | 'lot' | 'expires'>, cantidad: string): Promise<void> {
    const lotes = (await tx.execute(sql`SELECT lot, expires_on::text AS vence, sum(qty)::text AS saldo FROM stock_movements WHERE warehouse_id = ${base.warehouseId} AND ingredient_id = ${base.ingredientId} AND lot IS NOT NULL
      GROUP BY lot, expires_on HAVING sum(qty) > 0 ORDER BY expires_on ASC NULLS LAST, lot`)).rows as { lot: string; vence: string | null; saldo: string }[];
    let resto = cantidad;
    for (const l of lotes) {
      if (Number(resto) <= 0) break;
      const toma = (await tx.execute(sql`SELECT LEAST(${l.saldo}::numeric, ${resto}::numeric)::text AS q, (${resto}::numeric - LEAST(${l.saldo}::numeric, ${resto}::numeric))::text AS r`)).rows[0] as { q: string; r: string };
      await this.registrar(tx, t, por, { ...base, qty: `-${toma.q}`, lot: l.lot, expires: l.vence });
      resto = toma.r;
    }
    if (Number(resto) > 0) await this.registrar(tx, t, por, { ...base, qty: `-${resto}` });
  }

  movimiento(t: Tenant, por: string, d: z.infer<typeof Movimiento>) {
    return this.db.run(t, async (tx) => {
      await this.almacenValido(tx, t, d.almacenId);
      if (d.tipo === 'compra' && d.costoUnitario === undefined) throw new BadRequestException('La compra necesita el costo unitario.');
      if ((d.tipo === 'merma' || d.tipo === 'ajuste') && !d.motivo) throw new BadRequestException('Indica el motivo.');
      if (d.tipo === 'ajuste' && !d.sentido) throw new BadRequestException('Indica si el ajuste es de entrada o de salida.');
      if ((d.lote || d.vence) && d.tipo !== 'compra' && !(d.tipo === 'ajuste' && d.sentido === 'entrada')) throw new BadRequestException('El lote y el vencimiento solo van en entradas.');
      const entra = d.tipo === 'compra' || (d.tipo === 'ajuste' && d.sentido === 'entrada');
      const c = await this.aUnidadDelInsumo(tx, t, d.insumoId, d.cantidad, d.unidad, d.costoUnitario);
      const grupo = randomUUID();
      const base = { warehouseId: d.almacenId, ingredientId: d.insumoId, reason: d.motivo ?? null, groupId: grupo };
      if (entra) await this.registrar(tx, t, por, { ...base, kind: d.tipo === 'compra' ? 'compra' : 'ajuste', qty: c.qty, unitCost: c.costo, lot: d.lote ?? null, expires: d.vence ?? null });
      else await this.salidaFefo(tx, t, por, { ...base, kind: d.tipo === 'merma' ? 'merma' : 'ajuste' }, c.qty);
      await this.conta.deMovimiento(tx, t, por, d.tipo, grupo);
      // Merma y ajustes son sensibles: quedan en la auditoría general además del kardex.
      if (d.tipo !== 'compra') await auditar(tx, t.restaurantId, por, `inventario.${d.tipo}`, 'ingredient', d.insumoId, { almacenId: d.almacenId, cantidad: c.qty, unidad: c.unidadInsumo, motivo: d.motivo, sentido: d.sentido });
      return { ok: true, cantidadEnUnidadDelInsumo: c.qty, unidad: c.unidadInsumo };
    });
  }

  traspaso(t: Tenant, por: string, d: z.infer<typeof Traspaso>) {
    if (d.origenId === d.destinoId) throw new BadRequestException('El origen y el destino son el mismo almacén.');
    return this.db.run(t, async (tx) => {
      await this.almacenValido(tx, t, d.origenId); await this.almacenValido(tx, t, d.destinoId);
      const c = await this.aUnidadDelInsumo(tx, t, d.insumoId, d.cantidad, d.unidad);
      const costo = (await tx.execute(sql`SELECT avg_cost::text AS c FROM stock_levels WHERE warehouse_id = ${d.origenId} AND ingredient_id = ${d.insumoId}`)).rows[0] as { c: string } | undefined;
      const grupo = randomUUID();
      await this.salidaFefo(tx, t, por, { kind: 'traspaso_out', warehouseId: d.origenId, ingredientId: d.insumoId, groupId: grupo }, c.qty);
      await this.registrar(tx, t, por, { kind: 'traspaso_in', warehouseId: d.destinoId, ingredientId: d.insumoId, qty: c.qty, unitCost: costo?.c ?? null, groupId: grupo });
      await auditar(tx, t.restaurantId, por, 'inventario.traspaso', 'ingredient', d.insumoId, { origen: d.origenId, destino: d.destinoId, cantidad: c.qty });
      return { ok: true };
    });
  }

  /** Conteo físico: ajusta cada diferencia con un movimiento y devuelve lo que costó (valorizado al costo promedio). */
  conteo(t: Tenant, por: string, d: z.infer<typeof Conteo>) {
    return this.db.run(t, async (tx) => {
      await this.almacenValido(tx, t, d.almacenId);
      const grupo = randomUUID(); const salida: { insumoId: string; nombre: string; unidad: string; sistema: string; contado: string; diferencia: string; valor: string }[] = [];
      let total = '0';
      for (const l of d.lineas) {
        const r = await tx.execute(sql`SELECT i.name, i.unit_code, COALESCE(s.qty, 0)::text AS sistema, COALESCE(s.avg_cost, i.last_cost)::text AS costo, (${l.contado.toFixed(3)}::numeric - COALESCE(s.qty, 0))::text AS dif,
            round((${l.contado.toFixed(3)}::numeric - COALESCE(s.qty, 0)) * COALESCE(s.avg_cost, i.last_cost), 2)::text AS valor
          FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id AND s.warehouse_id = ${d.almacenId} WHERE i.id = ${l.insumoId} AND i.restaurant_id = ${t.restaurantId}`);
        const f = r.rows[0] as { name: string; unit_code: string; sistema: string; costo: string; dif: string; valor: string } | undefined;
        if (!f) throw new BadRequestException('Uno de los insumos no existe en esta sucursal.');
        if (Number(f.dif) !== 0) {
          const motivo = `Conteo físico${d.motivo ? `: ${d.motivo}` : ''}`;
          if (Number(f.dif) > 0) await this.registrar(tx, t, por, { kind: 'ajuste', warehouseId: d.almacenId, ingredientId: l.insumoId, qty: f.dif, reason: motivo, groupId: grupo, refType: 'conteo' });
          else await this.salidaFefo(tx, t, por, { kind: 'ajuste', warehouseId: d.almacenId, ingredientId: l.insumoId, reason: motivo, groupId: grupo, refType: 'conteo' }, f.dif.replace('-', ''));
          total = ((await tx.execute(sql`SELECT (${total}::numeric + ${f.valor}::numeric)::text AS t`)).rows[0] as { t: string }).t;
        }
        salida.push({ insumoId: l.insumoId, nombre: f.name, unidad: f.unit_code, sistema: f.sistema, contado: l.contado.toFixed(3), diferencia: f.dif, valor: f.valor });
      }
      if (Number(total) !== 0) await this.conta.ajusteRegistrado(tx, t, por, grupo, total);
      await auditar(tx, t.restaurantId, por, 'inventario.conteo', 'warehouse', d.almacenId, { lineas: d.lineas.length, valorDiferencia: total });
      return { almacenId: d.almacenId, lineas: salida, valorDiferencia: total };
    });
  }

  /* ---------------- consultas ---------------- */

  niveles(t: Tenant, almacenId?: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT s.warehouse_id, w.name AS almacen, s.ingredient_id, i.name, i.unit_code, s.qty::text AS qty, s.avg_cost::text AS costo, round(s.qty * s.avg_cost, 2)::text AS valor
        FROM stock_levels s JOIN warehouses w ON w.id = s.warehouse_id JOIN ingredients i ON i.id = s.ingredient_id WHERE s.restaurant_id = ${t.restaurantId} ${almacenId ? sql`AND s.warehouse_id = ${almacenId}` : sql``} ORDER BY i.name, w.name`);
      return (r.rows as Record<string, string>[]).map((x) => ({ almacenId: x.warehouse_id, almacen: x.almacen, insumoId: x.ingredient_id, insumo: x.name, unidad: x.unit_code, cantidad: x.qty, costoPromedio: x.costo, valor: x.valor }));
    });
  }

  kardex(t: Tenant, insumoId: string, almacenId?: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM (SELECT m.id, m.kind, m.qty::text AS qty, m.unit_cost::text AS costo, m.lot, m.expires_on::text AS vence, m.reason, m.created_at, w.name AS almacen,
          sum(m.qty) OVER (PARTITION BY ${almacenId ? sql`m.warehouse_id` : sql`m.ingredient_id`} ORDER BY m.created_at, m.id)::text AS saldo
        FROM stock_movements m JOIN warehouses w ON w.id = m.warehouse_id WHERE m.restaurant_id = ${t.restaurantId} AND m.ingredient_id = ${insumoId} ${almacenId ? sql`AND m.warehouse_id = ${almacenId}` : sql``}) k ORDER BY id DESC LIMIT 300`);
      return (r.rows as Record<string, unknown>[]).map((x) => ({ id: x.id, tipo: x.kind, cantidad: x.qty, costo: x.costo, lote: x.lot, vence: x.vence, motivo: x.reason, fecha: new Date(String(x.created_at)).toISOString(), almacen: x.almacen, saldo: x.saldo }));
    });
  }

  /** Alertas de stock: bajo el mínimo, en negativo (el inventario del sistema difiere de la realidad) y lotes por vencer. */
  alertas(t: Tenant, diasVencimiento = 7) {
    return this.db.run(t, async (tx) => {
      const bajos = await tx.execute(sql`SELECT i.id, i.name, i.unit_code, i.min_stock::text AS minimo, COALESCE(SUM(s.qty), 0)::numeric(14,3)::text AS stock FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id
        WHERE i.restaurant_id = ${t.restaurantId} AND i.active AND i.min_stock > 0 GROUP BY i.id HAVING COALESCE(SUM(s.qty), 0) < i.min_stock ORDER BY i.name`);
      const negativos = await tx.execute(sql`SELECT i.id, i.name, i.unit_code, w.name AS almacen, s.qty::text AS qty FROM stock_levels s JOIN ingredients i ON i.id = s.ingredient_id JOIN warehouses w ON w.id = s.warehouse_id WHERE s.restaurant_id = ${t.restaurantId} AND s.qty < 0 ORDER BY i.name`);
      const vencen = await tx.execute(sql`SELECT i.id, i.name, i.unit_code, m.lot, m.expires_on::text AS vence, (m.expires_on - (now() AT TIME ZONE 'America/La_Paz')::date)::int AS dias, w.name AS almacen, sum(m.qty)::text AS saldo
        FROM stock_movements m JOIN ingredients i ON i.id = m.ingredient_id JOIN warehouses w ON w.id = m.warehouse_id WHERE m.restaurant_id = ${t.restaurantId} AND m.lot IS NOT NULL AND m.expires_on IS NOT NULL
        GROUP BY i.id, i.name, i.unit_code, m.lot, m.expires_on, w.name HAVING sum(m.qty) > 0 AND m.expires_on <= (now() AT TIME ZONE 'America/La_Paz')::date + ${diasVencimiento}::int ORDER BY m.expires_on`);
      return {
        bajoMinimo: (bajos.rows as Record<string, string>[]).map((x) => ({ insumoId: x.id, insumo: x.name, unidad: x.unit_code, stock: x.stock, minimo: x.minimo })),
        negativos: (negativos.rows as Record<string, string>[]).map((x) => ({ insumoId: x.id, insumo: x.name, unidad: x.unit_code, almacen: x.almacen, cantidad: x.qty })),
        porVencer: (vencen.rows as Record<string, string | number>[]).map((x) => ({ insumoId: x.id, insumo: x.name, unidad: x.unit_code, lote: x.lot, vence: x.vence, dias: x.dias, almacen: x.almacen, saldo: x.saldo })),
      };
    });
  }
}
