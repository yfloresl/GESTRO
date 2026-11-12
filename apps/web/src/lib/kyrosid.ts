import type { KyrosIdPublico } from '@gestro/contracts';
import { abrirEnNavegadorDelSistema, CLIENT_NATIVO, esAppNativa, REDIRECT_NATIVO } from './nativo';

/**
 * Ingreso con Kyros ID: Authorization Code + PKCE S256 con el client público `gestro-web`
 * (sso-kyros-id-standard.md). Los tokens del emisor se usan una vez y se descartan: nada de
 * `code`, `state` ni tokens en la URL persistente ni en localStorage. sessionStorage solo guarda
 * state/nonce/verifier durante la redirección y se borra al volver.
 */

/** Autenticación aceptada de hasta 30 min: si Kyros ID ya tiene sesión, no pide la contraseña (app-interna-estandar.md §1.2). */
export const KYROS_LOGIN_MAX_AGE_SECONDS = 28800;   // 8 h: el SSO dura la jornada, como en el resto del ecosistema
const CLAVE = 'gestro.pkce';

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aleatorio = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Solo rutas internas de la app: nada de esquemas, `//` ni otros orígenes (redirección abierta). */
export function destinoSeguro(destino: string | null | undefined): string {
  if (!destino || !destino.startsWith('/app') || destino.startsWith('//') || /[\\\s]/.test(destino) || destino.includes('://')) return '/app';
  return destino;
}

export interface OpcionesIngreso { registro?: boolean; destino?: string; /** Fuerza contraseña + segundo factor ahora (SuperAdmin central: PLATAFORMA_REAUTH). */ reauth?: boolean }

/** En la app Android el client y el redirect son los nativos; en el navegador, los de siempre. */
const clienteDe = (cfg: KyrosIdPublico) => (esAppNativa() ? CLIENT_NATIVO : cfg.clientId);
const redirectDe = () => (esAppNativa() ? REDIRECT_NATIVO : `${location.origin}/callback`);

export function urlDeIngreso(cfg: KyrosIdPublico, pkce: { state: string; nonce: string; challenge: string }, o: OpcionesIngreso = {}): string {
  const base = o.registro ? cfg.authorizationEndpoint.replace(/\/auth$/, '/registrations') : cfg.authorizationEndpoint;
  const q = new URLSearchParams({
    client_id: clienteDe(cfg), redirect_uri: redirectDe(), response_type: 'code', scope: 'openid',
    code_challenge: pkce.challenge, code_challenge_method: 'S256', state: pkce.state, nonce: pkce.nonce,
    // Ingreso normal: sin prompt=login y con max_age=28800 (8 h). Nunca 0 ni ausente.
    max_age: String(KYROS_LOGIN_MAX_AGE_SECONDS),
  });
  if (o.reauth) q.set('prompt', 'login');   // solo para confirmar la identidad del administrador de plataforma; el ingreso normal nunca lo lleva
  return `${base}?${q}`;
}

export async function iniciarIngreso(cfg: KyrosIdPublico, o: OpcionesIngreso = {}): Promise<void> {
  const verifier = aleatorio(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const pkce = { state: aleatorio(16), nonce: aleatorio(16) };
  const guardado = JSON.stringify({ ...pkce, verifier, destino: destinoSeguro(o.destino), en: Date.now() });
  if (esAppNativa()) localStorage.setItem(CLAVE, guardado); else sessionStorage.setItem(CLAVE, guardado);
  const url = urlDeIngreso(cfg, { ...pkce, challenge }, o);
  if (await abrirEnNavegadorDelSistema(url)) return;   // app Android: Kyros ID en Custom Tabs, nunca en el WebView
  location.assign(url);
}

/** Vuelve de Kyros ID: valida `state`, limpia la URL y canjea el `code` por un token de acceso (que se usa una sola vez). */
export async function completarIngreso(cfg: KyrosIdPublico): Promise<{ accessToken: string; destino: string }> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code'); const state = params.get('state');
  history.replaceState(null, '', '/callback'); // fuera de la URL de inmediato
  const almacen = esAppNativa() ? localStorage : sessionStorage;
  const guardado = (() => { try { const g = JSON.parse(almacen.getItem(CLAVE) ?? 'null'); return g && (!g.en || Date.now() - g.en < 600_000) ? g : null; } catch { return null; } })();
  almacen.removeItem(CLAVE);
  if (!code || !state || !guardado || guardado.state !== state) throw new Error('El ingreso no coincide con tu solicitud. Vuelve a intentarlo.');
  const r = await fetch(cfg.tokenEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clienteDe(cfg), code, redirect_uri: redirectDe(), code_verifier: guardado.verifier }),
  });
  if (!r.ok) throw new Error('Kyros ID no aceptó el ingreso. Vuelve a intentarlo.');
  const { access_token } = (await r.json()) as { access_token?: string };
  if (!access_token) throw new Error('Kyros ID no devolvió un acceso válido.');
  return { accessToken: access_token, destino: destinoSeguro(guardado.destino) };
}

/** «Cerrar sesión cierra tu cuenta Kyros en todos los sistemas» (RP-initiated logout). */
export function cerrarKyrosId(cfg: KyrosIdPublico): void {
  const q = new URLSearchParams({ client_id: clienteDe(cfg), post_logout_redirect_uri: `${location.origin}/` });
  location.assign(`${cfg.endSessionEndpoint}?${q}`);
}
