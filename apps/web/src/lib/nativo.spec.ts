import { describe, expect, it } from 'vitest';
import { busquedaDelRetorno, esAppNativa, REDIRECT_NATIVO } from './nativo';

describe('puente de la app Android', () => {
  it('fuera de la app nativa todo es inerte', () => { expect(esAppNativa()).toBe(false); });

  it('del retorno solo pasan code, state y error; lo demás se descarta', () => {
    expect(busquedaDelRetorno(`${REDIRECT_NATIVO}?code=abc&state=xyz&session_state=zzz&iss=q`)).toBe('?code=abc&state=xyz');
    expect(busquedaDelRetorno(`${REDIRECT_NATIVO}?error=access_denied&state=s`)).toBe('?state=s&error=access_denied');
    expect(busquedaDelRetorno(`${REDIRECT_NATIVO}?code=abc&state=xyz#fragmento=1`)).toBe('?code=abc&state=xyz');
  });

  it('rechaza otros esquemas, sin parámetros útiles o valores gigantes', () => {
    for (const malo of ['https://gestro.kyros-tech.com/callback?code=a&state=b', 'com.kyros.otra://callback?code=a&state=b', `${REDIRECT_NATIVO}`, `${REDIRECT_NATIVO}?otro=1`, `${REDIRECT_NATIVO}?code=${'a'.repeat(3000)}`]) expect(busquedaDelRetorno(malo), malo).toBeNull();
  });
});
