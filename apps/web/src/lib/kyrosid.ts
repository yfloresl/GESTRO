import type { KyrosIdPublico } from '@gestro/contracts';

/**
 * Ingreso con Kyros ID: Authorization Code + PKCE S256 con el client público `gestro-web`
 * (sso-kyros-id-standard.md). Los tokens del emisor se usan una vez y se descartan: nada de
 * `code`, `state` ni tokens en la URL persistente ni en localStorage. sessionStorage solo guarda
 * state/nonce/verifier durante la redirección y se borra al volver.
 */

/** Autenticación aceptada de hasta 30 min: si Kyros ID ya tiene sesión, no pide la contraseña (app-interna-estandar.md §1.2). */
export const KYROS_LOGIN_MAX_AGE_SECONDS = 1800;
const CLAVE = 'gestro.pkce';

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const aleatorio = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Solo rutas internas de la app: nada de esquemas, `//` ni otros orígenes (redirección abierta). */
export function destinoSeguro(destino: string | null | undefined): string {
  if (!destino || !destino.startsWith('/app') || destino.startsWith('//') || /[\\\s]/.test(destino) || destino.includes('://')) return '/app';
  return destino;
}

export interface OpcionesIngreso { registro?: boolean; destino?: string }

export function urlDeIngreso(cfg: KyrosIdPublico, pkce: { state: string; nonce: string; challenge: string }, o: OpcionesIngreso = {}): string {
  const base = o.registro ? cfg.authorizationEndpoint.replace(/\/auth$/, '/registrations') : cfg.authorizationEndpoint;
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: `${location.origin}/callback`, response_type: 'code', scope: 'openid',
    code_challenge: pkce.challenge, code_challenge_method: 'S256', state: pkce.state, nonce: pkce.nonce,
    // Ingreso normal: sin prompt=login y con max_age=1800. Nunca 0 ni ausente.
    max_age: String(KYROS_LOGIN_MAX_AGE_SECONDS),
  });
  return `${base}?${q}`;
}

export async function iniciarIngreso(cfg: KyrosIdPublico, o: OpcionesIngreso = {}): Promise<void> {
  const verifier = aleatorio(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const pkce = { state: aleatorio(16), nonce: aleatorio(16) };
  sessionStorage.setItem(CLAVE, JSON.stringify({ ...pkce, verifier, destino: destinoSeguro(o.destino) }));
  location.assign(urlDeIngreso(cfg, { ...pkce, challenge }, o));
}

/** Vuelve de Kyros ID: valida `state`, limpia la URL y canjea el `code` por un token de acceso (que se usa una sola vez). */
export async function completarIngreso(cfg: KyrosIdPublico): Promise<{ accessToken: string; destino: string }> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code'); const state = params.get('state');
  history.replaceState(null, '', '/callback'); // fuera de la URL de inmediato
  const guardado = (() => { try { return JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null'); } catch { return null; } })();
  sessionStorage.removeItem(CLAVE);
  if (!code || !state || !guardado || guardado.state !== state) throw new Error('El ingreso no coincide con tu solicitud. Vuelve a intentarlo.');
  const r = await fetch(cfg.tokenEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, code, redirect_uri: `${location.origin}/callback`, code_verifier: guardado.verifier }),
  });
  if (!r.ok) throw new Error('Kyros ID no aceptó el ingreso. Vuelve a intentarlo.');
  const { access_token } = (await r.json()) as { access_token?: string };
  if (!access_token) throw new Error('Kyros ID no devolvió un acceso válido.');
  return { accessToken: access_token, destino: destinoSeguro(guardado.destino) };
}

/** «Cerrar sesión cierra tu cuenta Kyros en todos los sistemas» (RP-initiated logout). */
export function cerrarKyrosId(cfg: KyrosIdPublico): void {
  const q = new URLSearchParams({ client_id: cfg.clientId, post_logout_redirect_uri: `${location.origin}/` });
  location.assign(`${cfg.endSessionEndpoint}?${q}`);
}
