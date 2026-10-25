import { join } from 'node:path';

/**
 * Único lugar que mira el entorno del proceso. Estándar Sistemas-Kyros: aquí no hay ningún
 * secreto, solo literales que el docker-compose fija a la vista. Las claves viven cifradas en
 * la base (tabla app_config) y la llave maestra en el volumen gestro_secretos.
 */
const e = process.env;

export const entorno = {
  produccion: e.MODO === 'produccion',
  puerto: Number(e.PUERTO ?? 4000),
  /** Sin contraseña: la base solo es alcanzable por la red interna del compose. */
  baseDeDatos: e.BASE_DE_DATOS ?? 'postgresql://gestro@127.0.0.1:5434/gestro',
  /** Carpeta de la llave maestra. En producción es el volumen privado gestro_secretos. */
  dirSecretos: e.DIR_SECRETOS ?? join(process.cwd(), '.datos', 'secretos'),
  /** Carpeta de archivos (fotos de platos, vouchers). */
  dirArchivos: e.DIR_ARCHIVOS ?? join(process.cwd(), '.datos', 'archivos'),
  /** Dirección pública del sistema, para armar enlaces. */
  urlPublica: e.URL_PUBLICA ?? 'http://localhost:5173',
};
