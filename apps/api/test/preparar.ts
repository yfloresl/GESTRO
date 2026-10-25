import { Pool } from 'pg';
import { aplicarMigraciones } from '../src/database/migraciones';

const ADMIN = 'postgresql://gestro@127.0.0.1:5434/postgres';
const PRUEBAS = 'postgresql://gestro@127.0.0.1:5434/gestro_pruebas';

/** Base de pruebas limpia en cada corrida: se recrea y se le aplican las migraciones reales. */
export default async function preparar() {
  const admin = new Pool({ connectionString: ADMIN, max: 1 });
  try {
    await admin.query('DROP DATABASE IF EXISTS gestro_pruebas WITH (FORCE)');
    await admin.query('CREATE DATABASE gestro_pruebas');
  } finally { await admin.end(); }
  await aplicarMigraciones(PRUEBAS);
}
