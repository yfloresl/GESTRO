/**
 * Datos de muestra para presentar o probar GESTRO, en la terminal del contenedor `api`:
 *   node dist/src/scripts/crear-datos-demo.js --sucursal <slug> --confirmo
 * Carga en una sucursal NUEVA (sin pedidos, platos, insumos ni asientos): menú con recetas, inventario con stock, proveedores, mesas, 60 días de
 * ventas con su consumo y costo, mermas, asientos contables, una promoción y un evento. Si la sucursal ya tiene datos, no hace nada.
 * NO es para restaurantes reales: mezclaría ventas inventadas con las verdaderas. (Las cuentas Prueba_Kyros usan la consola de plataforma.)
 */
import { Pool } from 'pg';
import { entorno } from '../config/entorno';
import { cargarDatosDemo } from '../demo/datos-demo';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const tiene = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  const slug = arg('sucursal');
  if (!slug || !tiene('confirmo')) { console.error('Uso: --sucursal <slug> --confirmo   (carga datos de MUESTRA en una sucursal nueva)'); process.exit(2); }
  const pool = new Pool({ connectionString: entorno.baseDeDatos, max: 1 });
  const c = await pool.connect();
  try {
    const rest = (await c.query('SELECT id, timezone FROM restaurants WHERE slug = $1', [slug])).rows[0] as { id: string; timezone: string } | undefined;
    if (!rest) { console.error(`No existe la sucursal «${slug}».`); process.exit(1); }
    for (const [tabla, que] of [['orders', 'pedidos'], ['menu_items', 'platos'], ['journal_entries', 'asientos contables'], ['ingredients', 'insumos']] as const) {
      if ((await c.query(`SELECT 1 FROM ${tabla} WHERE restaurant_id = $1 LIMIT 1`, [rest.id])).rows.length) { console.error(`La sucursal ya tiene ${que}: los datos de muestra solo se cargan en una sucursal nueva.`); process.exit(1); }
    }
    await c.query('BEGIN');
    const r = await cargarDatosDemo(c, rest.id, rest.timezone, 60);
    await c.query('COMMIT');
    console.log(`Datos de muestra cargados en «${slug}»: ${r.platos} platos con receta, ${r.insumos} insumos, ${r.pedidos} pedidos de los últimos 60 días (Bs ${r.ventas}), ${r.asientos} asientos, 1 promoción y 1 evento.`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
