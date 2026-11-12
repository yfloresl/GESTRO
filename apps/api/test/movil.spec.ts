import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KyrosIdService } from '../src/kyros-id/kyros-id.service';
import { CLIENT, LEGAL, levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const MOVIL = 'gestro-mobile';
const canje = (token: string) => t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: token });

describe('App Android: client gestro-mobile', () => {
  it('lista cerrada: acepta azp=aud=gestro-mobile (y el de la web); rechaza otros clients y mezclas azp/aud', async () => {
    const ok = await canje(t.firmar({ azp: MOVIL, aud: [MOVIL] }));
    expect(ok.status).toBe(200); expect(ok.body.estado).toBe('sin_vinculo');
    expect((await canje(t.firmar({ azp: CLIENT, aud: [CLIENT] }))).status).toBe(200);
    for (const malo of [{ azp: 'otro-client', aud: ['otro-client'] }, { azp: MOVIL, aud: [CLIENT] }, { azp: CLIENT, aud: [MOVIL] }, { azp: MOVIL, aud: ['otro'] }, { azp: 'portal-web', aud: ['portal-web'] }]) {
      expect((await canje(t.firmar(malo))).status, JSON.stringify(malo)).toBe(401);
    }
  });

  it('con el token móvil se registra un restaurante y se vuelve a entrar; el SuperAdmin central NO entra por la app móvil', async () => {
    const sub = randomUUID();
    const c = await canje(t.firmar({ sub, azp: MOVIL, aud: [MOVIL] }));
    const reg = await t.api().post('/api/v1/auth/kyros-id/registro').send({ ...LEGAL, registroToken: c.body.registroToken, nombre: 'Rosa Móvil', correo: `${randomUUID()}@t.bo`, restaurante: 'Casa Móvil', razonSocial: 'Casa Móvil SRL' });
    expect(reg.status).toBe(200);
    const otra = await canje(t.firmar({ sub, azp: MOVIL, aud: [MOVIL] }));
    expect(otra.body.estado).toBe('sesion'); expect(otra.body.sesion.usuario.esPlataforma).toBe(false);

    await t.app.get(KyrosIdService).guardar({ activo: true, emisor: t.emisor, clientId: CLIENT, audiencia: CLIENT, plataformaSso: true }, randomUUID());
    try {
      const pa = await canje(t.firmar({ azp: MOVIL, aud: [MOVIL], kyros_pa: ['kyros-platform-admin'], acr: '1' }));
      expect(pa.status).toBe(200); expect(pa.body.estado).toBe('sin_vinculo');   // el claim se ignora: sin usuario central
    } finally { await t.app.get(KyrosIdService).guardar({ activo: true, emisor: t.emisor, clientId: CLIENT, audiencia: CLIENT, plataformaSso: false }, randomUUID()); }
  });
});
