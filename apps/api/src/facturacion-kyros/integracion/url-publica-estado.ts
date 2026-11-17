import { derivarUrlPublica, type EntradaUrl } from './url-publica';

/**
 * R1 (parte con estado, sin BD): «ultima URL publica conocida» en memoria + middleware. La persistencia y el aviso de cambio los hace el servicio del
 * sistema (`onCambioDeUrl`). Sin dependencias del sistema: `esDesarrollo` FALLA CERRADO (sin configurar = produccion).
 */
let conocida: string | null = null;
let alCambiar: ((url: string) => void) | null = null;

let desarrolloFn: () => boolean = () => false; // FALLA CERRADO: sin configurar cuenta como produccion
/** El sistema indica como sabe si es desarrollo (`() => !isProduction()`); asi este archivo no lee el entorno. */
export function configurarDesarrollo(fn: () => boolean): void { desarrolloFn = fn; }
export const esDesarrollo = (): boolean => desarrolloFn();
export const urlPublicaConocida = (): string | null => conocida;
export const origenPublicoDerivado = (): string => conocida ?? '';
export function fijarUrlConocida(url: string | null): void { conocida = url; }
export function onCambioDeUrl(cb: ((url: string) => void) | null): void { alCambiar = cb; }
/** Solo para pruebas. */
export function _reiniciarUrlPublica(valor: string | null = null): void { conocida = valor; alCambiar = null; }

/** UNICA fuente de la URL publica: deriva de la peticion, la guarda como «ultima conocida» y avisa si cambio el dominio. Si la peticion no sirve, devuelve la ultima conocida. */
export function urlPublica(req: EntradaUrl): string | null {
  const r = derivarUrlPublica(req, { desarrollo: esDesarrollo() });
  if (r.ok && r.url !== conocida) {
    conocida = r.url;
    alCambiar?.(r.url);
  }
  return conocida;
}

export function urlPublicaMiddleware(req: EntradaUrl, _res: unknown, next: () => void): void {
  try { urlPublica(req); } catch { /* nunca rompe la peticion */ }
  next();
}
