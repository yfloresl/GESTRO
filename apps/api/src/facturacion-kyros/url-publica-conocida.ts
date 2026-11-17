/**
 * Ultima URL publica conocida de Kyros Dental (https://dominio), en memoria. La escribe SOLO `IntegracionFacturaSinService` (derivada de las peticiones con
 * `urlPublica` del nucleo) y la lee quien arma enlaces absolutos (retorno de pagos, webhooks). Sin dependencias: se puede importar desde cualquier modulo.
 */
let conocida: string | null = null;
export const urlPublicaConocida = (): string | null => conocida;
export const origenPublicoDerivado = (): string => conocida ?? '';
export function fijarUrlConocida(url: string | null): void { conocida = url; }
