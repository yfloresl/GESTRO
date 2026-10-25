import { createPublicKey, KeyObject, verify } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Validación de los tokens de acceso de Kyros ID (Keycloak), sin dependencias, según
 * `sso-kyros-id-standard.md`: solo RS256, clave del JWKS del emisor por `kid` (nunca del
 * token), `iss` exacto, `azp` igual al client y `aud` que incluye la audiencia propia,
 * `typ` Bearer, `exp` obligatorio y hasta 10 s de tolerancia en `nbf` e `iat`.
 * El uso único por `jti` lo controla quien llama, contra la base.
 */

/** El token no sirve: la respuesta al navegador es siempre la misma, sin detalles. */
export class TokenInvalido extends Error {}
/** No hay claves del emisor y no se pudieron descargar: se responde con un aviso amable. */
export class EmisorNoDisponible extends Error {}

export interface Reclamos {
  sub: string; iss: string; azp: string; exp: number; jti?: string; iat?: number; auth_time?: number;
  preferred_username?: string; email?: string; given_name?: string; family_name?: string; name?: string;
  [extra: string]: unknown;
}

export interface Esperado { emisor: string; clientId: string; audiencia: string }

const TOLERANCIA_S = 10;
const ENFRIAMIENTO_MS = 30_000;
const TOPE_BYTES = 64 * 1024;

const json = (parte: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* cae al error de abajo */ }
  throw new TokenInvalido('Formato inválido.');
};

/** La URL de las claves sale del emisor (convención de Keycloak), sin discovery. */
export const urlDeClaves = (emisor: string) => `${emisor.replace(/\/+$/, '')}/protocol/openid-connect/certs`;

/** Direcciones que nunca puede tener un emisor en producción. */
export function esDireccionPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    return mapeada ? esDireccionPrivada(mapeada[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function verificarHostPublico(url: URL): Promise<void> {
  if (url.protocol !== 'https:') throw new EmisorNoDisponible('El emisor debe usar https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const direcciones = isIP(host) ? [host] : (await lookup(host, { all: true })).map((d) => d.address);
  if (!direcciones.length || direcciones.some(esDireccionPrivada)) throw new EmisorNoDisponible('El emisor no tiene una dirección pública.');
}

async function leerConTope(r: Response, tope: number): Promise<string> {
  const lector = r.body?.getReader();
  if (!lector) return '';
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > tope) { await lector.cancel(); throw new EmisorNoDisponible('Respuesta del emisor demasiado grande.'); }
    partes.push(value);
  }
  return Buffer.concat(partes).toString('utf8');
}

/**
 * Claves públicas del emisor en memoria. Se vuelven a pedir cuando vence la copia o aparece
 * un `kid` desconocido, como máximo cada 30 s y con una sola descarga en vuelo. Si el emisor
 * no responde se sigue usando la copia anterior.
 */
export class ClavesDelEmisor {
  private claves = new Map<string, KeyObject>();
  private cargadas = 0;
  private ultimoIntento = -Infinity;
  private enVuelo: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly opciones: { produccion: boolean; vigenciaMs?: number; ahora?: () => number } = { produccion: true },
  ) {}

  private ahora() { return (this.opciones.ahora ?? Date.now)(); }

  async clave(kid: string): Promise<KeyObject> {
    const vigente = this.ahora() - this.cargadas < (this.opciones.vigenciaMs ?? 10 * 60_000);
    if (vigente && this.claves.has(kid)) return this.claves.get(kid)!;
    if (this.ahora() - this.ultimoIntento >= ENFRIAMIENTO_MS) await this.recargar().catch(() => undefined);
    const k = this.claves.get(kid);
    if (k) return k;
    if (!this.claves.size) throw new EmisorNoDisponible('No se pudieron obtener las claves del emisor.');
    throw new TokenInvalido('Clave desconocida.');
  }

  private recargar(): Promise<void> {
    if (!this.enVuelo) {
      this.ultimoIntento = this.ahora();
      this.enVuelo = this.descargar().finally(() => { this.enVuelo = null; });
    }
    return this.enVuelo;
  }

  private async descargar(): Promise<void> {
    const url = new URL(this.url);
    if (this.opciones.produccion) await verificarHostPublico(url);
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new EmisorNoDisponible(`El emisor respondió ${r.status}.`);
    const cuerpo = JSON.parse(await leerConTope(r, TOPE_BYTES)) as { keys?: Record<string, string>[] };
    const nuevas = new Map<string, KeyObject>();
    for (const k of cuerpo.keys ?? []) {
      if (k.kty !== 'RSA' || !k.kid || !k.n || !k.e) continue;
      if (k.use && k.use !== 'sig') continue;
      if (k.alg && k.alg !== 'RS256') continue;
      try { nuevas.set(k.kid, createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' })); } catch { /* clave mal formada: se ignora */ }
    }
    if (!nuevas.size) throw new EmisorNoDisponible('El emisor no publicó claves RS256.');
    this.claves = nuevas;
    this.cargadas = this.ahora();
  }
}

/** Lee un JWT firmado por el emisor: formato, solo RS256, `kid` y firma. No mira ningún dato todavía. */
export async function leerFirmado(token: string, claves: ClavesDelEmisor): Promise<Record<string, unknown>> {
  if (typeof token !== 'string' || token.length > 8192) throw new TokenInvalido('Formato inválido.');
  const partes = token.split('.');
  if (partes.length !== 3 || partes.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new TokenInvalido('Formato inválido.');
  const [h, p, s] = partes;
  const cabecera = json(h);
  // El algoritmo se decide antes de buscar la clave: none, HS*, ES* y PS* quedan fuera.
  if (cabecera.alg !== 'RS256') throw new TokenInvalido('Algoritmo no permitido.');
  if (typeof cabecera.kid !== 'string' || !cabecera.kid) throw new TokenInvalido('Sin kid.');
  const clave = await claves.clave(cabecera.kid);
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), clave, Buffer.from(s, 'base64url'))) throw new TokenInvalido('Firma inválida.');
  return json(p);
}

const EVENTO_CIERRE = 'http://schemas.openid.net/event/backchannel-logout';

/**
 * Aviso de cierre de sesión global (back-channel logout de OIDC): firmado por el emisor, para
 * este client, con el evento de cierre, sin `nonce`, con `jti` y emitido hace poco.
 */
export async function validarAvisoDeCierre(token: string, esperado: { emisor: string; clientId: string }, claves: ClavesDelEmisor, ahoraMs = Date.now()): Promise<{ sub?: string; sid?: string; jti: string; exp: number }> {
  const r = await leerFirmado(token, claves);
  const ahora = ahoraMs / 1000;
  if (r.iss !== esperado.emisor) throw new TokenInvalido('Emisor distinto.');
  const aud = Array.isArray(r.aud) ? r.aud : [r.aud];
  if (!aud.includes(esperado.clientId)) throw new TokenInvalido('Audiencia distinta.');
  const eventos = r.events;
  if (!eventos || typeof eventos !== 'object' || !(EVENTO_CIERRE in eventos)) throw new TokenInvalido('No es un aviso de cierre.');
  if (r.nonce !== undefined) throw new TokenInvalido('Un aviso de cierre no lleva nonce.');
  if (typeof r.iat !== 'number' || r.iat > ahora + TOLERANCIA_S || r.iat < ahora - 300) throw new TokenInvalido('Aviso fuera de tiempo.');
  if (r.exp !== undefined && (typeof r.exp !== 'number' || r.exp <= ahora)) throw new TokenInvalido('Vencido.');
  if (typeof r.jti !== 'string' || !r.jti || r.jti.length > 200) throw new TokenInvalido('Sin jti.');
  const sub = typeof r.sub === 'string' && r.sub ? r.sub : undefined;
  const sid = typeof r.sid === 'string' && r.sid ? r.sid : undefined;
  if (!sub && !sid) throw new TokenInvalido('Sin sub ni sid.');
  return { sub, sid, jti: r.jti, exp: typeof r.exp === 'number' ? r.exp : Math.floor(ahora) + 300 };
}

/** Valida un token de acceso de Kyros ID y devuelve sus datos. Lanza TokenInvalido o EmisorNoDisponible. */
export async function validarToken(token: string, esperado: Esperado, claves: ClavesDelEmisor, ahoraMs = Date.now()): Promise<Reclamos> {
  const r = await leerFirmado(token, claves);
  const ahora = ahoraMs / 1000;
  if (r.iss !== esperado.emisor) throw new TokenInvalido('Emisor distinto.');
  if (r.typ !== 'Bearer') throw new TokenInvalido('No es un token de acceso.');
  if (r.azp !== esperado.clientId) throw new TokenInvalido('Client distinto.');
  const aud = Array.isArray(r.aud) ? r.aud : [r.aud];
  if (!aud.includes(esperado.audiencia)) throw new TokenInvalido('Audiencia distinta.');
  if (typeof r.exp !== 'number' || r.exp <= ahora) throw new TokenInvalido('Vencido.');
  if (r.nbf !== undefined && (typeof r.nbf !== 'number' || r.nbf > ahora + TOLERANCIA_S)) throw new TokenInvalido('Todavía no válido.');
  if (r.iat !== undefined && (typeof r.iat !== 'number' || r.iat > ahora + TOLERANCIA_S)) throw new TokenInvalido('Emitido en el futuro.');
  if (typeof r.sub !== 'string' || !r.sub) throw new TokenInvalido('Sin sub.');
  if (r.jti !== undefined && (typeof r.jti !== 'string' || !r.jti || r.jti.length > 200)) throw new TokenInvalido('jti inválido.');
  return r as Reclamos;
}
