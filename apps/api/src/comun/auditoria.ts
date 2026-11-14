import type { Bd } from '../database/database.module';
import { sql } from 'drizzle-orm';
import { auditLog } from '../database/esquema';

/** Toda acción sensible deja rastro de quién, cuándo y qué (se llama dentro de la misma transacción). */
export function auditar(tx: Bd, restaurantId: string, userId: string | null, action: string, entity: string, entityId: string, after?: unknown) {
  return tx.insert(auditLog).values({ restaurantId, userId, action, entity, entityId, after: after ?? null });
}

const ARCHIVABLES = ['menu_items', 'menu_categories', 'ingredients', 'promotions', 'staff_functions', 'shifts', 'journal_entries', 'order_items'] as const;
/**
 * «Nada se borra»: guarda la copia completa de la fila (y las líneas de un asiento) en archived_records ANTES de eliminarla.
 * Se llama dentro de la misma transacción, justo antes del DELETE; si el DELETE no ocurre, la transacción se revierte con todo.
 */
export async function archivar(tx: Bd, restaurantId: string, userId: string | null, tabla: (typeof ARCHIVABLES)[number], id: string) {
  if (!ARCHIVABLES.includes(tabla)) throw new Error(`Tabla no archivable: ${tabla}`);
  const extra = tabla === 'journal_entries' ? sql`|| jsonb_build_object('lines', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM journal_lines l WHERE l.entry_id = t.id), '[]'::jsonb))` : sql``;
  await tx.execute(sql`INSERT INTO archived_records (restaurant_id, entity, entity_id, snapshot, deleted_by)
    SELECT ${restaurantId}::uuid, ${tabla}, t.id, to_jsonb(t) ${extra}, ${userId}::uuid FROM ${sql.raw(tabla)} t WHERE t.id = ${id}::uuid`);
}

/** Errores de restricción única de Postgres, vengan directos o envueltos por Drizzle. */
export function esDuplicado(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === '23505' || x?.cause?.code === '23505';
}
