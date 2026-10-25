import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const TABLA = 'CREATE TABLE IF NOT EXISTS _migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())';

/** Aplica, en orden y una sola vez, los .sql de ./migraciones. Con `revertir` deshace la última. */
export async function aplicarMigraciones(cadena: string, opciones: { revertir?: boolean } = {}): Promise<string[]> {
  const pool = new Pool({ connectionString: cadena, max: 1 });
  const dir = join(__dirname, 'migraciones');
  const hechasAhora: string[] = [];
  try {
    await pool.query(TABLA);
    const hechas = new Set((await pool.query('SELECT nombre FROM _migraciones')).rows.map((r) => r.nombre as string));
    if (opciones.revertir) {
      const ultima = [...hechas].sort().pop();
      if (!ultima) return [];
      const reversa = join(__dirname, 'reversas', ultima);
      if (!existsSync(reversa)) throw new Error(`La migración ${ultima} no tiene reversa.`);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(readFileSync(reversa, 'utf8'));
        await c.query(TABLA); // la reversa de 0001 borra el esquema completo, incluida esta tabla
        await c.query('DELETE FROM _migraciones WHERE nombre = $1', [ultima]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      return [ultima];
    }
    for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (hechas.has(archivo)) continue;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(readFileSync(join(dir, archivo), 'utf8'));
        await c.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [archivo]);
        await c.query('COMMIT');
        hechasAhora.push(archivo);
      } catch (error) {
        await c.query('ROLLBACK');
        throw new Error(`Migración ${archivo}: ${(error as Error).message}`);
      } finally { c.release(); }
    }
  } finally {
    await pool.end();
  }
  return hechasAhora;
}
