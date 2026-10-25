/**
 * Alta o reclamo del superadmin de plataforma, en la terminal del contenedor `api`:
 *   node dist/src/scripts/crear-superadmin.js --email x@kyros-tech.com --nombre "Nombre" --sub <sub de Kyros ID>
 * El `sub` lo entrega Identidad. Crea el usuario de plataforma y lo vincula de una vez.
 */
import { Pool } from 'pg';
import { entorno } from '../config/entorno';
import { EMISOR_POR_DEFECTO } from '../kyros-id/kyros-id.service';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const email = arg('email'); const nombre = arg('nombre'); const sub = arg('sub'); const emisor = (arg('emisor') ?? EMISOR_POR_DEFECTO).replace(/\/+$/, '');
  if (!email || !nombre || !sub) { console.error('Uso: --email <correo> --nombre <nombre> --sub <sub de Kyros ID> [--emisor <url>]'); process.exit(2); }
  const pool = new Pool({ connectionString: entorno.baseDeDatos, max: 1 });
  try {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(
        `INSERT INTO users (email, full_name, is_platform_admin) VALUES ($1,$2,true)
         ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, active = true RETURNING id`, [email, nombre]);
      await c.query('INSERT INTO kyros_links (issuer, sub, user_id) VALUES ($1,$2,$3)', [emisor, sub, u.rows[0].id]);
      await c.query(`INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1,'superadmin.reclamado','user',$1)`, [u.rows[0].id]);
      await c.query('COMMIT');
      console.log(`Superadmin listo: ${email}`);
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
