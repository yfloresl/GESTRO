/**
 * Alta o reclamo del superadmin de plataforma, en la terminal del contenedor `api`:
 *   node dist/src/scripts/crear-superadmin.js --email x@kyros-tech.com --nombre "Nombre"
 * Sin `--sub` crea el usuario de plataforma y entrega un CÓDIGO de un solo uso (24 h): la persona entra con Kyros ID, lo
 * escribe en «Tengo un código de invitación» y queda vinculada por su identidad. No hay contraseñas que cambiar después.
 * Con `--sub <sub de Kyros ID>` vincula de una vez. Se puede repetir para emitir otro código si el anterior venció.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { entorno } from '../config/entorno';
import { EMISOR_POR_DEFECTO } from '../kyros-id/kyros-id.service';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const email = arg('email'); const nombre = arg('nombre'); const sub = arg('sub'); const emisor = (arg('emisor') ?? EMISOR_POR_DEFECTO).replace(/\/+$/, '');
  if (!email || !nombre) { console.error('Uso: --email <correo> --nombre <nombre> [--sub <sub de Kyros ID>] [--emisor <url>]'); process.exit(2); }
  const pool = new Pool({ connectionString: entorno.baseDeDatos, max: 1 });
  try {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query(
        `INSERT INTO users (email, full_name, is_platform_admin) VALUES ($1,$2,true)
         ON CONFLICT (email) DO UPDATE SET is_platform_admin = true, active = true RETURNING id`, [email, nombre]);
      const yaVinculado = (await c.query('SELECT 1 FROM kyros_links WHERE user_id = $1', [u.rows[0].id])).rows.length > 0;
      let codigo: string | null = null;
      if (sub) {
        await c.query('INSERT INTO kyros_links (issuer, sub, user_id) VALUES ($1,$2,$3)', [emisor, sub, u.rows[0].id]);
      } else if (!yaVinculado) {
        await c.query('DELETE FROM user_invitations WHERE user_id = $1 AND used_at IS NULL', [u.rows[0].id]);   // un código nuevo anula los anteriores sin usar
        codigo = `gst-${randomBytes(32).toString('base64url')}`;
        await c.query(`INSERT INTO user_invitations (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '24 hours')`, [u.rows[0].id, createHash('sha256').update(codigo).digest('hex')]);
      }
      await c.query(`INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1::uuid,'superadmin.reclamado','user',$1::text)`, [u.rows[0].id]);
      await c.query('COMMIT');
      console.log(`Superadmin listo: ${email}`);
      if (codigo) console.log(`
Código de un solo uso (vence en 24 horas):

  ${codigo}

Entra a GESTRO con Kyros ID y escríbelo en «Tengo un código de invitación».`);
      else if (yaVinculado && !sub) console.log('Este usuario ya está vinculado a una identidad de Kyros ID: no hace falta ningún código.');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
