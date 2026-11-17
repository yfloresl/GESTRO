/**
 * Version del modulo comun de integracion con FacturaSIN (carpeta `facturacion/integracion/`). IDENTICO en los 7 sistemas Kyros: cualquier
 * cambio sube esta version y se copia tal cual a los demas. Los archivos puros de esta carpeta (version, url-publica, convencion, webhook, enlace)
 * no importan nada del sistema que los aloja, de modo que se copian sin tocar. La parte especifica de cada sistema (tabla de estado, rutas,
 * lectura de secretos) vive en `integracion-fs.service.ts`.
 */
export const INTEGRACION_FS_VERSION = '1.0.0';
