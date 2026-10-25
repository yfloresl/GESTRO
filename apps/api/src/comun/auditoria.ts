import type { Bd } from '../database/database.module';
import { auditLog } from '../database/esquema';

/** Toda acción sensible deja rastro de quién, cuándo y qué (se llama dentro de la misma transacción). */
export function auditar(tx: Bd, restaurantId: string, userId: string | null, action: string, entity: string, entityId: string, after?: unknown) {
  return tx.insert(auditLog).values({ restaurantId, userId, action, entity, entityId, after: after ?? null });
}

/** Errores de restricción única de Postgres, vengan directos o envueltos por Drizzle. */
export function esDuplicado(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code === '23505' || x?.cause?.code === '23505';
}
