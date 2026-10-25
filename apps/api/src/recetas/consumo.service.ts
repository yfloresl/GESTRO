import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { uuidArray } from '../comun/sql';
import { Bd, Tenant } from '../database/database.module';
import { InventarioService } from '../inventario/inventario.service';
import { EventosGateway, salas } from '../tiempo-real/eventos.gateway';
import { PushService } from '../tiempo-real/push.service';
import { consumo, r3 } from './motor';
import { RecetasService } from './recetas.service';

/**
 * Descuento de insumos al ENVIAR a cocina (no al guardar): usa la receta activa del plato en ese momento y
 * la misma fórmula del plan del día. Un plato sin receta se vende y no descuenta; el stock puede quedar en
 * negativo (genera alerta, no bloquea). Cada movimiento lleva la referencia del ítem, y un ítem nunca se descuenta dos veces.
 */
@Injectable()
export class ConsumoService {
  constructor(
    @Inject(RecetasService) private readonly recetas: RecetasService,
    @Inject(InventarioService) private readonly inventario: InventarioService,
    @Inject(EventosGateway) private readonly eventos: EventosGateway,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /** Almacén del que se consume: el configurado en el insumo, si no el que más stock tiene, si no el primero. */
  private async almacenDe(tx: Bd, t: Tenant, insumoId: string): Promise<string | null> {
    const r = await tx.execute(sql`SELECT COALESCE(
        (SELECT default_warehouse_id FROM ingredients WHERE id = ${insumoId}),
        (SELECT warehouse_id FROM stock_levels WHERE ingredient_id = ${insumoId} ORDER BY qty DESC LIMIT 1),
        (SELECT id FROM warehouses WHERE restaurant_id = ${t.restaurantId} ORDER BY name LIMIT 1)) AS id`);
    return (r.rows[0] as { id: string | null }).id;
  }

  async descontar(tx: Bd, t: Tenant, userId: string | null, itemIds: string[]): Promise<{ consumidos: number }> {
    if (!itemIds.length) return { consumidos: 0 };
    const cat = await this.recetas.catalogo(tx, t);
    const items = (await tx.execute(sql`SELECT i.id, i.menu_item_id, i.qty::text AS qty FROM order_items i WHERE i.restaurant_id = ${t.restaurantId} AND i.id = ANY(${uuidArray(itemIds)}) AND i.voided_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.ref_type = 'order_item' AND m.ref_id = i.id AND m.kind = 'consumo')`)).rows as { id: string; menu_item_id: string; qty: string }[];
    const tocados = new Set<string>(); let n = 0;
    for (const it of items) {
      const receta = cat.recetaDePlato[it.menu_item_id];
      if (!receta) continue;
      for (const [insumoId, q] of consumo(cat, receta, it.qty)) {
        const cantidad = r3(q);
        if (Number(cantidad) <= 0) continue;
        const almacen = await this.almacenDe(tx, t, insumoId);
        if (!almacen) continue;
        await this.inventario.salidaFefo(tx, t, userId, { kind: 'consumo', warehouseId: almacen, ingredientId: insumoId, refType: 'order_item', refId: it.id }, cantidad);
        tocados.add(insumoId); n++;
      }
    }
    if (tocados.size) await this.revisarAlertas(tx, t, [...tocados]);
    return { consumidos: n };
  }

  /**
   * Abre una alerta «stock bajo» cuando un insumo cae bajo su mínimo (una sola abierta por insumo) y la resuelve
   * cuando se repone. Avisa en tiempo real y por Web Push a dueño, administración y almacén.
   */
  async revisarAlertas(tx: Bd, t: Tenant, insumoIds: string[]): Promise<void> {
    const r = await tx.execute(sql`SELECT i.id, i.name, i.unit_code, i.min_stock::float8 AS minimo, COALESCE(SUM(s.qty), 0)::float8 AS stock FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id
      WHERE i.restaurant_id = ${t.restaurantId} AND i.id = ANY(${uuidArray(insumoIds)}) GROUP BY i.id`);
    for (const x of r.rows as { id: string; name: string; unit_code: string; minimo: number; stock: number }[]) {
      const abierta = (await tx.execute(sql`SELECT id FROM alerts WHERE restaurant_id = ${t.restaurantId} AND kind = 'stock_bajo' AND resolved_at IS NULL AND data->>'insumoId' = ${x.id} LIMIT 1`)).rows[0] as { id: string } | undefined;
      if (x.minimo > 0 && x.stock < x.minimo) {
        if (abierta) continue;
        const sev = x.stock <= 0 ? 'alta' : 'media';
        const msg = `Stock bajo: ${x.name} (${Number(x.stock.toFixed(3))} ${x.unit_code}, mínimo ${x.minimo})`;
        await tx.execute(sql`INSERT INTO alerts (restaurant_id, kind, severity, message, data) VALUES (${t.restaurantId}, 'stock_bajo', ${sev}, ${msg}, ${JSON.stringify({ insumoId: x.id, stock: x.stock, minimo: x.minimo })}::jsonb)`);
        this.eventos.emitir(salas.sucursal(t.restaurantId), 'stock.alerta', { insumoId: x.id, mensaje: msg, severidad: sev });
        const dest = (await tx.execute(sql`SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.restaurant_id = ${t.restaurantId} AND ro.code IN ('owner','admin','almacen')`)).rows as { user_id: string }[];
        void this.push.avisar(dest.map((d) => d.user_id), { titulo: 'Stock bajo', cuerpo: msg, url: '/app/inventario', etiqueta: `stock-${x.id}` });
      } else if (abierta) {
        await tx.execute(sql`UPDATE alerts SET resolved_at = now() WHERE id = ${abierta.id}`);
      }
    }
  }
}
