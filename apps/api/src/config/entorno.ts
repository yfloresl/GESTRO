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

/**
 * Destinos de la facturación con FacturaSIN (Flujo 2). Son direcciones públicas, NO secretos: se leen en cada llamada para poder
 * apuntar a un doble de pruebas. El secreto del client `gestro-service` NO viene de aquí: vive cifrado en app_config
 * (consola de plataforma → Integraciones, clave KYROS_SERVICE_CLIENT_SECRET).
 */
export function destinosFacturasin() {
  const x = process.env;
  return {
    api: x.FACTURASIN_URL ?? 'https://facturasin.kyros-tech.com/api',
    emisor: x.KYROS_ID_EMISOR_SERVICIO ?? 'https://auth.kyros-tech.com/realms/kyros',
    clientId: x.KYROS_ID_CLIENT_SERVICIO ?? 'gestro-service',
    urlPublica: x.URL_PUBLICA ?? entorno.urlPublica,
  };
}
