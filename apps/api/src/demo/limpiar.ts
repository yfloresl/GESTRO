import type { PoolClient } from 'pg';

/**
 * Borra los datos de UNA sucursal sin enumerar tablas a mano: toma todas las tablas con `restaurant_id` (menos las que se conservan),
 * las ordena por sus claves foráneas (hijas antes que padres) y las vacía. Los triggers de inmutabilidad (asientos publicados, kardex) se
 * apagan solo dentro de la transacción con `session_replication_role = replica`, que exige privilegio de superusuario en la base.
 * Quien llama debe verificar ANTES que la sucursal es la de demostración: esta función no lo comprueba.
 */
export async function vaciarSucursal(c: PoolClient, rid: string, conservar: string[]): Promise<{ tablas: number }> {
  try { await c.query(`SET LOCAL session_replication_role = 'replica'`); }
  catch { throw new Error('Restablecer los datos de muestra exige que el usuario de la base sea superusuario (en el compose de producción lo es).'); }

  const tablas = (await c.query(`SELECT c.table_name AS t FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'restaurant_id'`)).rows.map((r) => r.t as string);
  const borrar = tablas.filter((t) => t !== 'restaurants' && !conservar.includes(t));
  const aristas = (await c.query(`SELECT conrelid::regclass::text AS hija, confrelid::regclass::text AS padre,
      (SELECT string_agg(quote_ident(attname), ',') FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey)) AS cols
    FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`)).rows as { hija: string; padre: string; cols: string }[];

  // Tablas que se conservan pero apuntan a algo que se borra (p. ej. staff_members.function_id): se anula la referencia.
  for (const a of aristas) {
    if (conservar.includes(a.hija) && borrar.includes(a.padre) && tablas.includes(a.hija)) {
      await c.query(`UPDATE ${a.hija} SET ${a.cols.split(',').map((x) => `${x} = NULL`).join(', ')} WHERE restaurant_id = $1`, [rid]);
    }
  }

  // Orden: una tabla se borra cuando ya no queda ninguna tabla por borrar que dependa de ella.
  const pendientes = new Set(borrar); let n = 0;
  while (pendientes.size) {
    const lista = [...pendientes].filter((t) => !aristas.some((a) => a.padre === t && a.hija !== t && pendientes.has(a.hija)));
    const turno = lista.length ? lista : [...pendientes];                    // ciclo inesperado: se intenta igual y se verá el error
    for (const t of turno) { await c.query(`DELETE FROM ${t} WHERE restaurant_id = $1`, [rid]); pendientes.delete(t); n++; }
  }
  return { tablas: n };
}
