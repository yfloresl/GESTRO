/**
 * gestro-p07: cierre global. Cuando Kyros ID avisa que la persona salió (back-channel logout) se revocan sus refresh tokens y, además,
 * se anota aquí el instante: el guard rechaza los tokens de acceso emitidos ANTES, para que GESTRO pida ingresar de nuevo de inmediato
 * y no a los 15 minutos de vida del token de acceso. Memoria del proceso: tras un reinicio el token de acceso vive, como máximo, sus 15 min.
 */
const VIDA_MS = 20 * 60_000;   // un poco más que la vida del token de acceso (15 min): pasado eso ya no hace falta recordarlo
const cierres = new Map<string, number>();

export function marcarCierre(userId: string, ahora = Date.now()): void {
  for (const [k, t] of cierres) if (ahora - t > VIDA_MS) cierres.delete(k);
  cierres.set(userId, ahora);
}

/** ¿Un token emitido en `iat` (segundos) quedó invalidado por un cierre global de esa persona? */
export function tokenCerrado(userId: string, iatSegundos: number | undefined): boolean {
  const t = cierres.get(userId);
  if (t === undefined) return false;
  if (iatSegundos === undefined) return true;
  return iatSegundos < Math.floor(t / 1000);
}

export function _limpiarCierres(): void { cierres.clear(); }
