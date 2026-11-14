/** Hora de Bolivia (UTC-4, sin horario de verano). «Hoy» nunca se calcula en UTC ni con la zona del servidor. */
export const OFFSET_BOLIVIA_MS = 4 * 3_600_000;

/** Fecha de calendario en Bolivia (AAAA-MM-DD) para un instante dado (por defecto, ahora). */
export function hoyBolivia(ahoraMs: number = Date.now()): string {
  return new Date(ahoraMs - OFFSET_BOLIVIA_MS).toISOString().slice(0, 10);
}

/** Hoy en Bolivia más `dias` días de calendario (aritmética sobre la fecha, sin horas). */
export function hoyBoliviaMas(dias: number, ahoraMs: number = Date.now()): string {
  const [a, m, d] = hoyBolivia(ahoraMs).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
