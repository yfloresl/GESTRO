/** Más de 12 h «en cocina» ya no es una demora: es un pedido que quedó abierto (se olvidó cobrar o anular). */
export const MAX_MIN_COCINA = 12 * 60;
export function duracion(min: number): string {
  if (min < 120) return `${min} min`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} días`;
}
/** gestro-021: texto de la alerta; un pedido de días no se describe como «7511 min en cocina». */
export function mensajeDemora(x: { ticket: number | null; mesa: string | null; minutos: number; umbral: number; plato: string }): string {
  const quien = `${x.ticket ? `#${x.ticket}` : ''}${x.mesa ? ` (mesa ${x.mesa})` : ''}`.trim();
  const ped = quien ? `El pedido ${quien}` : 'Un pedido';
  if (x.minutos > MAX_MIN_COCINA) return `${ped} lleva ${duracion(x.minutos)} abierto sin cerrarse. Revísalo: cóbralo o anúlalo si ya no corresponde.`;
  return `${ped} lleva ${duracion(x.minutos)} en cocina; el límite para «${x.plato}» es ${x.umbral} min.`;
}
