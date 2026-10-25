import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { Catalogo, CicloDeRecetas, costoPorPorcion, faltantes, margenPct, r2, r3, r4, Receta, RecetaInvalida, requerimientos, UnidadIncompatible, validarSinCiclos } from './motor';

const Cant = z.number().positive().max(1_000_000).refine((n) => Math.round(n * 10000) / 10000 === n, 'Máximo 4 decimales');
export const NuevaReceta = z.object({
  platoId: z.string().uuid().optional(), insumoId: z.string().uuid().optional(),
  rendimiento: z.number().positive().max(100_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales'),
  mermaPct: z.number().min(0).max(100).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales').default(0), instrucciones: z.string().trim().max(4000).optional(),
  lineas: z.array(z.object({ insumoId: z.string().uuid(), cantidad: Cant, unidad: z.string().trim().min(1).max(10) }).strict()).min(1).max(40),
}).strict().refine((d) => !!d.platoId !== !!d.insumoId, { message: 'Indica el plato o el insumo que produce la sub-receta, solo uno.' });
export const PlanDelDia = z.object({ items: z.array(z.object({ platoId: z.string().uuid(), porciones: z.number().int().min(1).max(9999) }).strict()).max(100) }).strict();
export const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');

interface FilaReceta { id: string; menu_item_id: string | null; output_ingredient_id: string | null; version: number; yield_portions: string; waste_pct: string; instructions: string | null; active: boolean }

@Injectable()
export class RecetasService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Todo lo que el motor necesita, tal como está HOY: unidades, insumos y las recetas activas (platos y sub-recetas). */
  async catalogo(tx: Bd, t: Tenant, candidata?: { receta: Receta; platoId?: string; insumoId?: string }): Promise<Catalogo> {
    const u = (await tx.execute(sql`SELECT code, base_code, factor_to_base::text AS f FROM units`)).rows as { code: string; base_code: string; f: string }[];
    const ins = (await tx.execute(sql`SELECT id, name, unit_code FROM ingredients WHERE restaurant_id = ${t.restaurantId}`)).rows as { id: string; name: string; unit_code: string }[];
    const rs = (await tx.execute(sql`SELECT r.id, r.menu_item_id, r.output_ingredient_id, r.yield_portions::text, r.waste_pct::text,
        COALESCE(json_agg(json_build_object('insumoId', l.ingredient_id, 'cantidad', l.qty::text, 'unidad', l.unit_code)) FILTER (WHERE l.ingredient_id IS NOT NULL), '[]') AS lineas
      FROM recipes r LEFT JOIN recipe_lines l ON l.recipe_id = r.id WHERE r.restaurant_id = ${t.restaurantId} AND r.active GROUP BY r.id`)).rows as { id: string; menu_item_id: string | null; output_ingredient_id: string | null; yield_portions: string; waste_pct: string; lineas: Receta['lineas'] }[];
    const cat: Catalogo = { unidades: Object.fromEntries(u.map((x) => [x.code, { base: x.base_code, factor: x.f }])), insumos: Object.fromEntries(ins.map((i) => [i.id, { unidad: i.unit_code, nombre: i.name }])), recetaDePlato: {}, subRecetaDeInsumo: {} };
    for (const r of rs) {
      const rec: Receta = { id: r.id, rendimiento: r.yield_portions, mermaPct: r.waste_pct, lineas: r.lineas };
      if (r.menu_item_id) cat.recetaDePlato[r.menu_item_id] = rec; else if (r.output_ingredient_id) cat.subRecetaDeInsumo[r.output_ingredient_id] = rec;
    }
    // La receta candidata reemplaza a la activa de su destino para validar ciclos ANTES de guardarla.
    if (candidata) { if (candidata.platoId) cat.recetaDePlato[candidata.platoId] = candidata.receta; else if (candidata.insumoId) cat.subRecetaDeInsumo[candidata.insumoId] = candidata.receta; }
    return cat;
  }

  /** Costo vigente de cada insumo: promedio ponderado de sus almacenes o el último costo, según el método del insumo. */
  async costos(tx: Bd, t: Tenant): Promise<Record<string, string>> {
    const r = await tx.execute(sql`SELECT i.id, CASE WHEN i.cost_method = 'ultimo' THEN i.last_cost
        ELSE COALESCE(NULLIF(round(SUM(GREATEST(s.qty, 0) * s.avg_cost) / NULLIF(SUM(GREATEST(s.qty, 0)), 0), 4), 0), i.last_cost) END::text AS costo
      FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id WHERE i.restaurant_id = ${t.restaurantId} GROUP BY i.id`);
    return Object.fromEntries((r.rows as { id: string; costo: string }[]).map((x) => [x.id, x.costo]));
  }

  private traducir(e: unknown): never {
    if (e instanceof CicloDeRecetas) throw new ConflictException(`Esa receta crearía un ciclo entre sub-recetas (${e.ruta.length - 1} pasos). Revisa qué sub-receta usa a cuál.`);
    if (e instanceof UnidadIncompatible || e instanceof RecetaInvalida) throw new BadRequestException(e.message);
    throw e;
  }

  /** Platos con su receta activa, costo por porción y margen; marca los que bajan del margen mínimo y los que no tienen receta. */
  lista(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const cat = await this.catalogo(tx, t); const costos = await this.costos(tx, t);
      const [cfg] = (await tx.execute(sql`SELECT min_margin_pct::float8 AS m FROM restaurants WHERE id = ${t.restaurantId}`)).rows as { m: number }[];
      const platos = (await tx.execute(sql`SELECT id, name, price::text AS price, available, category_id FROM menu_items WHERE restaurant_id = ${t.restaurantId} ORDER BY name`)).rows as { id: string; name: string; price: string; available: boolean }[];
      const vers = (await tx.execute(sql`SELECT menu_item_id, id, version FROM recipes WHERE restaurant_id = ${t.restaurantId} AND active AND menu_item_id IS NOT NULL`)).rows as { menu_item_id: string; id: string; version: number }[];
      const out = platos.map((p) => {
        const rec = cat.recetaDePlato[p.id]; const v = vers.find((x) => x.menu_item_id === p.id);
        if (!rec) return { platoId: p.id, nombre: p.name, precio: p.price, disponible: p.available, tieneReceta: false, recetaId: null, version: null, costo: null, margen: null, bajoMinimo: false };
        let costo: Decimal | null = null;
        try { costo = costoPorPorcion(cat, rec, costos); } catch { costo = null; }
        const m = costo ? margenPct(p.price, costo) : null;
        return { platoId: p.id, nombre: p.name, precio: p.price, disponible: p.available, tieneReceta: true, recetaId: rec.id, version: v?.version ?? null, costo: costo ? r2(costo) : null, margen: m ? r2(m) : null, bajoMinimo: m ? m.lt(cfg.m) : false };
      });
      const subs = (await tx.execute(sql`SELECT r.id, r.output_ingredient_id, i.name, r.version, r.yield_portions::text AS rend FROM recipes r JOIN ingredients i ON i.id = r.output_ingredient_id WHERE r.restaurant_id = ${t.restaurantId} AND r.active ORDER BY i.name`)).rows as { id: string; output_ingredient_id: string; name: string; version: number; rend: string }[];
      return { margenMinimo: cfg.m, platos: out, subRecetas: subs.map((s) => ({ recetaId: s.id, insumoId: s.output_ingredient_id, nombre: s.name, version: s.version, rendimiento: s.rend })) };
    });
  }

  private async completa(tx: Bd, t: Tenant, id: string) {
    const [r] = (await tx.execute(sql`SELECT id, menu_item_id, output_ingredient_id, version, yield_portions::text, waste_pct::text, instructions, active FROM recipes WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows as unknown as FilaReceta[];
    if (!r) throw new NotFoundException('Receta no encontrada.');
    const lineas = (await tx.execute(sql`SELECT l.ingredient_id, i.name, l.qty::text AS qty, l.unit_code FROM recipe_lines l JOIN ingredients i ON i.id = l.ingredient_id WHERE l.recipe_id = ${id} ORDER BY i.name`)).rows as { ingredient_id: string; name: string; qty: string; unit_code: string }[];
    const cat = await this.catalogo(tx, t); const costos = await this.costos(tx, t);
    const rec: Receta = { id: r.id, rendimiento: (r as unknown as { yield_portions: string }).yield_portions, mermaPct: (r as unknown as { waste_pct: string }).waste_pct, lineas: lineas.map((l) => ({ insumoId: l.ingredient_id, cantidad: l.qty, unidad: l.unit_code })) };
    let costo: string | null = null;
    try { costo = r4(costoPorPorcion(cat, rec, costos)); } catch { costo = null; }
    const precio = r.menu_item_id ? ((await tx.execute(sql`SELECT price::text AS p FROM menu_items WHERE id = ${r.menu_item_id}`)).rows[0] as { p: string } | undefined)?.p ?? null : null;
    const m = costo && precio ? margenPct(precio, costo) : null;
    return { id: r.id, platoId: r.menu_item_id, insumoId: r.output_ingredient_id, version: r.version, activa: r.active, rendimiento: rec.rendimiento, mermaPct: rec.mermaPct, instrucciones: r.instructions, costoPorPorcion: costo, precio, margen: m ? r2(m) : null, lineas: lineas.map((l) => ({ insumoId: l.ingredient_id, insumo: l.name, cantidad: l.qty, unidad: l.unit_code, costo: costos[l.ingredient_id] ?? '0' })) };
  }

  detalle(t: Tenant, id: string) { return this.db.run(t, (tx) => this.completa(tx, t, id)); }

  /** Versiones de un plato o de una sub-receta, de la más nueva a la más vieja. */
  versiones(t: Tenant, destino: 'plato' | 'insumo', id: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT id, version, active, created_at FROM recipes WHERE restaurant_id = ${t.restaurantId} AND ${destino === 'plato' ? sql`menu_item_id` : sql`output_ingredient_id`} = ${id} ORDER BY version DESC`);
      return (r.rows as { id: string; version: number; active: boolean; created_at: string }[]).map((x) => ({ id: x.id, version: x.version, activa: x.active, creada: new Date(String(x.created_at)).toISOString() }));
    });
  }

  /** Un cambio de receta crea una versión nueva y deja inactiva la anterior (solo una versión activa por plato). */
  crear(t: Tenant, userId: string, d: z.infer<typeof NuevaReceta>) {
    return this.db.run(t, async (tx) => {
      const lineas = d.lineas.map((l) => ({ insumoId: l.insumoId, cantidad: l.cantidad.toFixed(4), unidad: l.unidad }));
      if (new Set(lineas.map((l) => l.insumoId)).size !== lineas.length) throw new BadRequestException('Un insumo solo puede aparecer una vez en la receta.');
      if (d.platoId) { const [p] = (await tx.execute(sql`SELECT 1 FROM menu_items WHERE id = ${d.platoId} AND restaurant_id = ${t.restaurantId}`)).rows; if (!p) throw new NotFoundException('El plato no existe en esta sucursal.'); }
      if (d.insumoId) { const [p] = (await tx.execute(sql`SELECT 1 FROM ingredients WHERE id = ${d.insumoId} AND restaurant_id = ${t.restaurantId} AND active`)).rows; if (!p) throw new NotFoundException('El insumo no existe o está desactivado.'); }
      const candidata: Receta = { id: 'nueva', rendimiento: d.rendimiento.toFixed(2), mermaPct: d.mermaPct.toFixed(2), lineas };
      try { validarSinCiclos(await this.catalogo(tx, t, { receta: candidata, platoId: d.platoId, insumoId: d.insumoId }), candidata); } catch (e) { this.traducir(e); }
      const col = d.platoId ? sql`menu_item_id` : sql`output_ingredient_id`; const destino = (d.platoId ?? d.insumoId)!;
      const v = (await tx.execute(sql`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM recipes WHERE ${col} = ${destino}`)).rows[0] as { v: number };
      await tx.execute(sql`UPDATE recipes SET active = false WHERE ${col} = ${destino} AND active`);
      const nueva = (await tx.execute(sql`INSERT INTO recipes (restaurant_id, menu_item_id, output_ingredient_id, version, yield_portions, waste_pct, instructions, active, created_by)
        VALUES (${t.restaurantId}, ${d.platoId ?? null}, ${d.insumoId ?? null}, ${v.v}, ${d.rendimiento.toFixed(2)}::numeric, ${d.mermaPct.toFixed(2)}::numeric, ${d.instrucciones ?? null}, true, ${userId}::uuid) RETURNING id`)).rows[0] as { id: string };
      for (const l of lineas) await tx.execute(sql`INSERT INTO recipe_lines (restaurant_id, recipe_id, ingredient_id, qty, unit_code) VALUES (${t.restaurantId}, ${nueva.id}, ${l.insumoId}, ${l.cantidad}::numeric, ${l.unidad})`);
      await auditar(tx, t.restaurantId, userId, 'receta.version_creada', 'recipe', nueva.id, { version: v.v, lineas: lineas.length });
      try { return await this.completa(tx, t, nueva.id); } catch (e) { return this.traducir(e); }
    }).catch((e) => { if ((e as { code?: string })?.code === '23503' || /unit_code|foreign key/i.test(String((e as Error)?.message))) throw new BadRequestException('Alguna unidad o insumo de la receta no existe.'); throw e; });
  }

  /** Vuelve a activar una versión anterior (revisa que no cree ciclos con lo que hay hoy). */
  activar(t: Tenant, userId: string, id: string) {
    return this.db.run(t, async (tx) => {
      const [r] = (await tx.execute(sql`SELECT menu_item_id, output_ingredient_id FROM recipes WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows as { menu_item_id: string | null; output_ingredient_id: string | null }[];
      if (!r) throw new NotFoundException('Receta no encontrada.');
      const lineas = (await tx.execute(sql`SELECT ingredient_id, qty::text AS qty, unit_code FROM recipe_lines WHERE recipe_id = ${id}`)).rows as { ingredient_id: string; qty: string; unit_code: string }[];
      const base = (await tx.execute(sql`SELECT yield_portions::text AS y, waste_pct::text AS w FROM recipes WHERE id = ${id}`)).rows[0] as { y: string; w: string };
      const cand: Receta = { id, rendimiento: base.y, mermaPct: base.w, lineas: lineas.map((l) => ({ insumoId: l.ingredient_id, cantidad: l.qty, unidad: l.unit_code })) };
      try { validarSinCiclos(await this.catalogo(tx, t, { receta: cand, platoId: r.menu_item_id ?? undefined, insumoId: r.output_ingredient_id ?? undefined }), cand); } catch (e) { this.traducir(e); }
      const col = r.menu_item_id ? sql`menu_item_id` : sql`output_ingredient_id`; const dest = (r.menu_item_id ?? r.output_ingredient_id)!;
      await tx.execute(sql`UPDATE recipes SET active = false WHERE ${col} = ${dest} AND active`);
      await tx.execute(sql`UPDATE recipes SET active = true WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, userId, 'receta.version_activada', 'recipe', id);
      return this.completa(tx, t, id);
    });
  }

  /* ---------------- plan del día ---------------- */

  /** Guarda los platos y porciones del día y el resultado del cálculo (para compararlo después con el consumo real). */
  guardarPlan(t: Tenant, userId: string, fecha: string, d: z.infer<typeof PlanDelDia>) {
    return this.db.run(t, async (tx) => {
      const ids = [...new Set(d.items.map((i) => i.platoId))];
      if (ids.length !== d.items.length) throw new BadRequestException('Un plato solo puede aparecer una vez en el plan.');
      for (const id of ids) { const [p] = (await tx.execute(sql`SELECT 1 FROM menu_items WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows; if (!p) throw new BadRequestException('Uno de los platos no existe en esta sucursal.'); }
      const plan = (await tx.execute(sql`INSERT INTO production_plans (restaurant_id, plan_date, source, created_by) VALUES (${t.restaurantId}, ${fecha}::date, 'manual', ${userId}::uuid)
        ON CONFLICT (restaurant_id, plan_date, source) DO UPDATE SET created_by = EXCLUDED.created_by RETURNING id`)).rows[0] as { id: string };
      await tx.execute(sql`DELETE FROM production_plan_items WHERE plan_id = ${plan.id}`);
      for (const i of d.items) await tx.execute(sql`INSERT INTO production_plan_items (restaurant_id, plan_id, menu_item_id, portions) VALUES (${t.restaurantId}, ${plan.id}, ${i.platoId}, ${i.porciones})`);
      const r = await this.calcularPlan(tx, t, fecha);
      await tx.execute(sql`UPDATE production_plans SET requirements = ${JSON.stringify(r.insumos.map((x) => ({ insumoId: x.insumoId, requerido: x.requerido, unidad: x.unidad })))}::jsonb, computed_at = now() WHERE id = ${plan.id}`);
      await auditar(tx, t.restaurantId, userId, 'plan.guardado', 'production_plan', plan.id, { fecha, platos: d.items.length });
      return r;
    });
  }

  verPlan(t: Tenant, fecha: string) { return this.db.run(t, (tx) => this.calcularPlan(tx, t, fecha)); }

  /** Insumos del día contra el stock actual de cada almacén: requerido, disponible total y faltante. */
  private async calcularPlan(tx: Bd, t: Tenant, fecha: string) {
    const items = (await tx.execute(sql`SELECT i.menu_item_id, i.portions, m.name FROM production_plan_items i JOIN production_plans p ON p.id = i.plan_id JOIN menu_items m ON m.id = i.menu_item_id
      WHERE p.restaurant_id = ${t.restaurantId} AND p.plan_date = ${fecha}::date ORDER BY m.name`)).rows as { menu_item_id: string; portions: number; name: string }[];
    const cat = await this.catalogo(tx, t); const costos = await this.costos(tx, t);
    let req; try { req = requerimientos(items.map((i) => ({ platoId: i.menu_item_id, porciones: i.portions })), cat); } catch (e) { this.traducir(e); }
    const st = (await tx.execute(sql`SELECT s.ingredient_id, w.name AS almacen, s.qty::text AS qty FROM stock_levels s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.restaurant_id = ${t.restaurantId}`)).rows as { ingredient_id: string; almacen: string; qty: string }[];
    const total: Record<string, Decimal> = {};
    for (const s of st) total[s.ingredient_id] = (total[s.ingredient_id] ?? new Decimal(0)).plus(s.qty);
    const falta = faltantes(req.requerido, total);
    let costoTotal = new Decimal(0);
    const insumos = [...req.requerido].map(([id, q]) => {
      costoTotal = costoTotal.plus(q.mul(costos[id] ?? 0));
      return { insumoId: id, insumo: cat.insumos[id]?.nombre ?? '', unidad: cat.insumos[id]?.unidad ?? '', requerido: r3(q), stock: r3(total[id] ?? new Decimal(0)), faltante: r3(falta.get(id) ?? new Decimal(0)), alcanza: !falta.has(id), porAlmacen: st.filter((s) => s.ingredient_id === id).map((s) => ({ almacen: s.almacen, cantidad: s.qty })) };
    }).sort((a, b) => a.insumo.localeCompare(b.insumo));
    const nombres = Object.fromEntries(items.map((i) => [i.menu_item_id, i.name]));
    return { fecha, platos: items.map((i) => ({ platoId: i.menu_item_id, nombre: i.name, porciones: i.portions, tieneReceta: !!cat.recetaDePlato[i.menu_item_id] })), insumos, sinReceta: req.sinReceta.map((id) => ({ platoId: id, nombre: nombres[id] })), hayFaltantes: falta.size > 0, costoEstimado: r2(costoTotal) };
  }
}
