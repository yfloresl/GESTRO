import { describe, expect, it } from 'vitest';
import type { KyrosIdPublico } from '@gestro/contracts';

// kyrosid.ts usa `location` solo dentro de funciones; se simula para probar la URL de autorización.
(globalThis as unknown as { location: { origin: string } }).location = { origin: 'https://gestro.kyros-tech.com' };
const { destinoSeguro, urlDeIngreso, KYROS_LOGIN_MAX_AGE_SECONDS } = await import('./kyrosid');

const cfg: KyrosIdPublico = {
  activo: true, emisor: 'https://auth.kyros-tech.com/realms/kyros', clientId: 'gestro-web',
  authorizationEndpoint: 'https://auth.kyros-tech.com/realms/kyros/protocol/openid-connect/auth',
  tokenEndpoint: 'https://auth.kyros-tech.com/realms/kyros/protocol/openid-connect/token',
  endSessionEndpoint: 'https://auth.kyros-tech.com/realms/kyros/protocol/openid-connect/logout',
};

describe('destinoSeguro (sin redirección abierta)', () => {
  it('acepta rutas internas de la app', () => {
    expect(destinoSeguro('/app/panel')).toBe('/app/panel');
    expect(destinoSeguro('/app')).toBe('/app');
  });
  it('rechaza otros orígenes, esquemas, // y rutas ajenas', () => {
    for (const malo of ['//evil.com', 'https://evil.com', '/\\evil.com', '/app//x', 'javascript:alert(1)', '/otra', '', null, undefined, '/app/../x y', '/app://x']) {
      if (malo === '/app//x') { expect(destinoSeguro(malo)).toBe('/app//x'); continue; } // ruta interna, no sale del origen
      expect(destinoSeguro(malo as string)).toBe('/app');
    }
  });
});

describe('URL de autorización', () => {
  const u = new URL(urlDeIngreso(cfg, { state: 's', nonce: 'n', challenge: 'c' }));
  it('usa PKCE S256, max_age=28800 y NO prompt=login en el ingreso normal', () => {
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('max_age')).toBe(String(KYROS_LOGIN_MAX_AGE_SECONDS));
    expect(KYROS_LOGIN_MAX_AGE_SECONDS).toBe(28800);
    expect(u.searchParams.has('prompt')).toBe(false);
    expect(u.searchParams.get('redirect_uri')).toBe('https://gestro.kyros-tech.com/callback');
    expect(u.searchParams.get('client_id')).toBe('gestro-web');
  });
  it('«Crear mi cuenta» usa el endpoint de registro de Keycloak', () => {
    expect(urlDeIngreso(cfg, { state: 's', nonce: 'n', challenge: 'c' }, { registro: true })).toContain('/protocol/openid-connect/registrations?');
  });
});
