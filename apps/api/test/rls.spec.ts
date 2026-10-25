import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const cadena = process.env.BASE_DE_DATOS!;
let owner: Pool;
const A = randomUUID();
const B = randomUUID();
const cuenta = randomUUID();

/** Ejecuta `fn` como app_user con el contexto de sucursal indicado (igual que TenantDb.run). */
async function comoApp<T>(ctx: { rid?: string; rids?: string; cliente?: string }, fn: (q: Pool['query']) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE app_user');
    await c.query(`SELECT set_config('app.restaurant_id',$1,true), set_config('app.restaurant_ids',$2,true), set_config('app.client_app_id',$3,true)`, [ctx.rid ?? '', ctx.rids ?? '', ctx.cliente ?? '']);
    return await fn(c.query.bind(c) as Pool['query']);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

beforeAll(async () => {
  owner = new Pool({ connectionString: cadena, max: 4 });
  await owner.query(`INSERT INTO accounts (id, legal_name, owner_email) VALUES ($1,'Cuenta RLS','rls@test.bo')`, [cuenta]);
  for (const [id, n] of [[A, 'A'], [B, 'B']]) {
    await owner.query(`INSERT INTO restaurants (id, account_id, name, slug) VALUES ($1,$2,$3,$4)`, [id, cuenta, `Sucursal ${n}`, `suc-${n.toLowerCase()}-${id.slice(0, 4)}`]);
    await owner.query(`INSERT INTO restaurant_tables (restaurant_id, number, seats) VALUES ($1,'1',4)`, [id]);
  }
});
afterAll(async () => { await owner.end(); });

describe('RLS: aislamiento por sucursal (rol app_user)', () => {
  it('con app.restaurant_id = A solo ve filas de A', async () => {
    const r = await comoApp({ rid: A }, (q) => q('SELECT restaurant_id FROM restaurant_tables'));
    expect(r.rows.map((x) => x.restaurant_id)).toEqual([A]);
  });

  it('con app.restaurant_id = A no puede insertar en B', async () => {
    await expect(comoApp({ rid: A }, (q) => q(`INSERT INTO restaurant_tables (restaurant_id, number, seats) VALUES ($1,'9',2)`, [B]))).rejects.toThrow(/row-level security/i);
  });

  it('con restaurant_ids = "A,B" ve ambas', async () => {
    const r = await comoApp({ rids: `${A},${B}` }, (q) => q('SELECT DISTINCT restaurant_id FROM restaurant_tables'));
    expect(r.rows.map((x) => x.restaurant_id).sort()).toEqual([A, B].sort());
  });

  it('sin contexto no ve nada', async () => {
    const r = await comoApp({}, (q) => q('SELECT 1 FROM restaurant_tables'));
    expect(r.rowCount).toBe(0);
  });

  it('restaurants se protege por su propio id', async () => {
    const r = await comoApp({ rid: A }, (q) => q('SELECT id FROM restaurants'));
    expect(r.rows.map((x) => x.id)).toEqual([A]);
  });

  it('el 100 % de las tablas con restaurant_id o client_app_id tiene RLS activada y forzada', async () => {
    const r = await owner.query(`
      SELECT n.nspname || '.' || c.relname AS tabla, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('public','fiscal')
        AND (c.relname = 'restaurants' OR EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname IN ('restaurant_id','client_app_id') AND NOT a.attisdropped))`);
    expect(r.rowCount).toBeGreaterThan(40);
    const sinRls = r.rows.filter((x) => !x.relrowsecurity || !x.relforcerowsecurity).map((x) => x.tabla);
    // audit_log y refresh/permisos de autenticación guardan restaurant_id opcional pero no son de negocio.
    expect(sinRls.filter((t: string) => t !== 'public.audit_log')).toEqual([]);
  });

  it('app_user no tiene BYPASSRLS ni es superusuario', async () => {
    const r = await owner.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'app_user'`);
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe('Restricciones de la base', () => {
  it('reservas solapadas en la misma mesa: la segunda falla; contiguas: pasa', async () => {
    const t = (await owner.query('SELECT id FROM restaurant_tables WHERE restaurant_id = $1', [A])).rows[0].id;
    const ins = (d: string, h: string) => owner.query(
      `INSERT INTO reservations (restaurant_id, table_id, customer_name, party_size, starts_at, ends_at, state) VALUES ($1,$2,'X',2,$3,$4,'confirmada')`, [A, t, d, h]);
    await ins('2030-01-01T19:00:00-04', '2030-01-01T21:00:00-04');
    await expect(ins('2030-01-01T20:00:00-04', '2030-01-01T22:00:00-04')).rejects.toThrow(/conflicting key|exclusion/i);
    await expect(ins('2030-01-01T21:00:00-04', '2030-01-01T22:00:00-04')).resolves.toBeTruthy();
  });

  it('publicar un asiento descuadrado falla; uno balanceado pasa', async () => {
    const acc = async (code: string, tipo: string) => (await owner.query(`INSERT INTO chart_of_accounts (restaurant_id, code, name, type) VALUES ($1,$2,$2,$3) RETURNING id`, [A, code, tipo])).rows[0].id;
    const caja = await acc('1.1', 'activo'); const ventas = await acc('4.1', 'ingreso');
    const entrada = async (n: number, haber: number) => {
      const e = (await owner.query(`INSERT INTO journal_entries (restaurant_id, entry_date, number, memo) VALUES ($1,now(),$2,'t') RETURNING id`, [A, n])).rows[0].id;
      await owner.query(`INSERT INTO journal_lines (restaurant_id, entry_id, account_id, debit) VALUES ($1,$2,$3,100)`, [A, e, caja]);
      await owner.query(`INSERT INTO journal_lines (restaurant_id, entry_id, account_id, credit) VALUES ($1,$2,$3,$4)`, [A, e, ventas, haber]);
      return e;
    };
    const malo = await entrada(1, 90);
    await expect(owner.query('UPDATE journal_entries SET posted = true WHERE id = $1', [malo])).rejects.toThrow(/descuadrado/);
    const bueno = await entrada(2, 100);
    await expect(owner.query('UPDATE journal_entries SET posted = true WHERE id = $1', [bueno])).resolves.toBeTruthy();
  });

  it('esquema fiscal: con app.client_app_id = X solo se ven contribuyentes de X', async () => {
    const mk = async (n: string) => (await owner.query(`INSERT INTO fiscal.client_apps (name, api_key_hash) VALUES ($1,$2) RETURNING id`, [n, randomUUID()])).rows[0].id;
    const X = await mk('X'); const Y = await mk('Y');
    for (const [c, nit] of [[X, '111'], [Y, '222']]) {
      await owner.query(`INSERT INTO fiscal.taxpayers (client_app_id, external_ref, nit, legal_name, modality) VALUES ($1,'r',$2,'T','electronica_en_linea')`, [c, nit]);
    }
    const r = await comoApp({ cliente: X }, (q) => q('SELECT nit FROM fiscal.taxpayers'));
    expect(r.rows.map((x) => x.nit)).toEqual(['111']);
  });

  it('kyros_links es inmutable: UPDATE falla, borrar desvincula', async () => {
    const u = (await owner.query(`INSERT INTO users (email, full_name) VALUES ('lnk@test.bo','L') RETURNING id`)).rows[0].id;
    await owner.query(`INSERT INTO kyros_links (issuer, sub, user_id) VALUES ('https://i','s1',$1)`, [u]);
    await expect(owner.query(`UPDATE kyros_links SET sub = 's2' WHERE user_id = $1`, [u])).rejects.toThrow(/inmutable/);
    await expect(owner.query(`DELETE FROM kyros_links WHERE user_id = $1`, [u])).resolves.toBeTruthy();
  });
});
