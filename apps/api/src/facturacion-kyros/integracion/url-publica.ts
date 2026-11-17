/**
 * R1. URL publica SIEMPRE DERIVADA de la peticion (X-Forwarded-Proto / X-Forwarded-Host o Host). Nunca de variables de entorno ni de ajustes:
 * si el dominio cambia, la siguiente peticion lo detecta. Funcion pura (sin Nest, sin BD) para probarla con cabeceras falsas.
 */
export interface EntradaUrl {
  headers: Record<string, string | string[] | undefined>;
  /** `req.protocol` de Express (ya respeta `trust proxy`); solo se usa si no hay X-Forwarded-Proto. */
  protocol?: string;
}
export type ResultadoUrl = { ok: true; url: string } | { ok: false; motivo: string };

const primero = (v: string | string[] | undefined): string => String(Array.isArray(v) ? v[0] : v ?? '').split(',')[0]!.trim().toLowerCase();

/** Host o IP no alcanzable desde Internet (localhost, loopback, redes privadas, link-local, nombres internos sin punto). */
export function esHostLocalOPrivado(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.test') || h.endsWith('.invalid')) return true;
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h) || h.startsWith('::ffff:');
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return !h.includes('.'); // `api`, `web`, `dental-api`: nombres de la red interna
}

const HOST_VALIDO = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:]+\])(?::\d{1,5})?$/;

export function derivarUrlPublica(e: EntradaUrl, o: { desarrollo: boolean }): ResultadoUrl {
  const proto = primero(e.headers['x-forwarded-proto']) || String(e.protocol ?? '').toLowerCase();
  const host = primero(e.headers['x-forwarded-host']) || primero(e.headers['host']);
  if (!host) return { ok: false, motivo: 'La peticion no trae el dominio (Host).' };
  // Solo `nombre[:puerto]`: rechaza rutas, credenciales (usuario@), espacios, esquemas y todo lo que permita desviar la URL a otro destino.
  if (!HOST_VALIDO.test(host)) return { ok: false, motivo: 'El dominio de la peticion no es valido.' };
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d+$/, '');
  if (proto !== 'https' && !(o.desarrollo && proto === 'http')) return { ok: false, motivo: 'La peticion no llego por https.' };
  if (!o.desarrollo && esHostLocalOPrivado(hostname)) return { ok: false, motivo: 'El dominio es local o de red privada: FacturaSIN no puede llamarlo.' };
  return { ok: true, url: `${proto}://${host}` };
}

/** Validacion de una URL ya armada: https publica o, solo en desarrollo, http/local. */
export function urlPublicaValida(url: string, o: { desarrollo: boolean }): boolean {
  try {
    const u = new URL(url);
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return false;
    if (u.protocol !== 'https:' && !(o.desarrollo && u.protocol === 'http:')) return false;
    return o.desarrollo || !esHostLocalOPrivado(u.hostname);
  } catch {
    return false;
  }
}
