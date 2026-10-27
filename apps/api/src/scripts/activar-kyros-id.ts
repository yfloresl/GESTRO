/**
 * Activa o apaga Kyros ID y fija el emisor y el client (configuración cifrada en la base, sin variables):
 *   node dist/src/scripts/activar-kyros-id.js --activo si --emisor https://auth.kyros-tech.com/realms/kyros --client gestro-web
 * Interruptor del SuperAdmin central (apagado por defecto; no cambia si no se nombra): --plataforma-sso si|no
 * En desarrollo: pnpm --filter @gestro/api exec tsx src/scripts/activar-kyros-id.ts --activo si --emisor http://localhost:4100/realms/kyros
 */
import { Pool } from 'pg';
import { entorno } from '../config/entorno';
import { SecretosService } from '../secretos/secretos.service';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const activo = ['si', 'true', '1'].includes((arg('activo') ?? 'si').toLowerCase());
  const emisor = (arg('emisor') ?? 'https://auth.kyros-tech.com/realms/kyros').replace(/\/+$/, '');
  const clientId = arg('client') ?? 'gestro-web';
  if (entorno.produccion && !emisor.startsWith('https://')) { console.error('En producción el emisor debe usar https.'); process.exit(2); }
  const secretos = new SecretosService();
  const pool = new Pool({ connectionString: entorno.baseDeDatos, max: 1 });
  try {
    // Conserva lo ya guardado (portal, interruptor del SuperAdmin central...) y solo cambia lo que se nombra.
    const previo = (await pool.query(`SELECT valor_cifrado FROM app_config WHERE clave = 'kyrosId'`)).rows[0];
    const antes = previo ? JSON.parse(secretos.descifrar(previo.valor_cifrado)) as Record<string, unknown> : {};
    const sso = arg('plataforma-sso');
    const valorCifrado = secretos.cifrar(JSON.stringify({ ...antes, activo, emisor, clientId, audiencia: arg('audiencia') ?? clientId, ...(sso ? { plataformaSso: ['si', 'true', '1'].includes(sso.toLowerCase()) } : {}) }));
    await pool.query(
      `INSERT INTO app_config (clave, valor_cifrado) VALUES ('kyrosId', $1)
       ON CONFLICT (clave) DO UPDATE SET valor_cifrado = EXCLUDED.valor_cifrado, actualizado = now()`, [valorCifrado]);
    console.log(`Kyros ID ${activo ? 'activado' : 'apagado'}: ${emisor} (client ${clientId}); SuperAdmin central ${(antes.plataformaSso || ['si','true','1'].includes((sso ?? '').toLowerCase())) && !['no','false','0'].includes((sso ?? '').toLowerCase()) ? 'ENCENDIDO' : 'apagado'}`);
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
