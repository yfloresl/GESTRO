/**
 * R3. Convencion sobre configuracion: lo que antes se tecleaba sale del nombre del sistema. IDENTICO en los 7 sistemas.
 */
export const CONVENCION = {
  clienteServicio: (sistema: string) => `${sistema}-service`,
  /** Empresa de Kyros-Tech en FacturaSIN (Flujo 1). */
  tenantKyros: 'kyros-tech',
  urlFacturaSin: 'https://facturasin.kyros-tech.com/api',
  /** Codigos fiscales PROVISIONALES de pruebas (NO CONFIRMADO: el contador los valida contra el catalogo sincronizado). */
  codigosProvisionales: { productoSin: '83141', actividadEconomica: '620100', unidadMedida: 58 },
  eventosWebhook: ['factura.pendiente', 'factura.validada', 'factura.observada', 'factura.rechazada', 'factura.anulada', 'factura.contingencia'],
} as const;

/** Id de empresa SIN prefijo de sistema (no duplica `dental:dental:x`), en minusculas y guiones. */
export function empresaExterna(sistema: string, tenantId: string): string {
  let t = String(tenantId ?? '').trim().toLowerCase();
  const prefijo = `${sistema.toLowerCase()}:`;
  while (t.startsWith(prefijo)) t = t.slice(prefijo.length);
  return t.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}
/** Valor de `X-Empresa-Externa`: `<sistema>:<tenantId>`. */
export const cabeceraEmpresa = (sistema: string, tenantId: string): string => `${sistema.toLowerCase()}:${empresaExterna(sistema, tenantId)}`;
