import { Inject, Injectable } from '@nestjs/common';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { IntegracionesService } from '../integraciones/integraciones';
import { EMISOR_POR_DEFECTO, KyrosIdService } from '../kyros-id/kyros-id.service';
import { FacturaSinClient, tokenClientCredentials } from './nucleo';
import { EnlaceFacturaSin } from './nucleo/enlace-facturasin';
import { convencion } from './nucleo/integracion';

const CONV = convencion('gestro');
export const SISTEMA = 'gestro';
/** Config no secreta de la integracion (url y client por convencion); solo desarrollo/pruebas la cambian. */
export const LLAVE_CONFIG = 'facturacion.kyros';
export const RETIRO_PUENTE = '2027-03-31';
export const TIEMPO_LLAMADA_MS = 10_000;

/**
 * Conexion con FacturaSIN de GESTRO (Flujo 1 y Flujo 2). La credencial es la PROPIA (`fsk_gestro_...`), pedida sola con el nucleo de enlace (copia exacta del de
 * FacturaSIN) y guardada cifrada; ante 401 se vuelve a enlazar una vez. La credencial puente de Keycloak (`gestro-service`) solo sirve para el primer enlace.
 */
@Injectable()
export class FacturaSinConexion {
  private enlaceFs?: EnlaceFacturaSin;
  private enlaceUrl = '';
  /** Para las pruebas: sustituye el `fetch` saliente. */
  fetchImpl?: typeof fetch;
  /** Token del administrador de plataforma (solo en el instante de «Conectar»; nunca se guarda). */
  private tokenArranque: string | null = null;

  constructor(
    @Inject(ConfiguracionService) private readonly cfg: ConfiguracionService,
    @Inject(IntegracionesService) private readonly integ: IntegracionesService,
    @Inject(KyrosIdService) private readonly kid: KyrosIdService,
  ) {}

  async tieneCredencial(): Promise<boolean> { return !!(await this.integ.obtener('FACTURASIN_CREDENCIAL')); }
  async puedeEnlazar(): Promise<boolean> { return !!(await this.integ.obtener('KYROS_SERVICE_CLIENT_SECRET')) || !!(await this.integ.obtener('FACTURASIN_SECRETO_PLATAFORMA')); }
  /** «Conectada» = credencial propia guardada. */
  conectada(): Promise<boolean> { return this.tieneCredencial(); }
  async tipoCredencial(): Promise<'propia' | 'puente' | 'ninguna'> {
    if (await this.tieneCredencial()) return 'propia';
    return (await this.puedeEnlazar()) ? 'puente' : 'ninguna';
  }

  private fetchConTiempo(): typeof fetch {
    const base: typeof fetch = this.fetchImpl ?? ((u, i) => fetch(u, i));
    return (u, i) => base(u, { ...i, signal: AbortSignal.timeout(TIEMPO_LLAMADA_MS) });
  }
  private async ajustes(): Promise<{ url?: string; clientId?: string; issuer?: string | null; empresa?: string }> {
    return (await this.cfg.leer<{ url?: string; clientId?: string; issuer?: string | null; empresa?: string }>(LLAVE_CONFIG)) ?? {};
  }
  async urlBase(): Promise<string> { return (await this.ajustes()).url || CONV.url; }

  /** Nucleo de enlace de FacturaSIN: enlaza solo, guarda la credencial cifrada y se re-enlaza ante 401. */
  async enlace(): Promise<EnlaceFacturaSin> {
    const url = await this.urlBase();
    if (this.enlaceFs && this.enlaceUrl === url) return this.enlaceFs;
    this.enlaceUrl = url;
    const fetchImpl = this.fetchConTiempo();
    this.enlaceFs = new EnlaceFacturaSin({
      baseUrl: url, sistema: SISTEMA, fetchImpl, version: '2.0.0',
      almacen: {
        leer: async () => (await this.integ.obtener('FACTURASIN_CREDENCIAL')) || null,
        guardar: async (valor) => { if (valor) await this.integ.guardarDeServicio('FACTURASIN_CREDENCIAL', valor); },
      },
      credencialPuente: async () => {
        const secreto = await this.integ.obtener('KYROS_SERVICE_CLIENT_SECRET');
        if (!secreto) return null;
        const a = await this.ajustes();
        const issuer = a.issuer || (await this.kid.ajustes()).emisor || EMISOR_POR_DEFECTO;
        return tokenClientCredentials({ issuer, clientId: a.clientId || CONV.clientId, clientSecret: secreto, fetchImpl })();
      },
      secretoPlataforma: async () => (await this.integ.obtener('FACTURASIN_SECRETO_PLATAFORMA')) || null,
      tokenArranque: async () => this.tokenArranque,
    });
    return this.enlaceFs;
  }

  /** Enlace automatico al arrancar o al «Conectar y probar»: idempotente; si ya hay credencial no hace nada. `token` = administrador de plataforma (opcional, no se guarda). */
  async enlazarSiFalta(token?: string | null): Promise<'ya_enlazada' | 'enlazada' | 'sin_arranque'> {
    if (await this.tieneCredencial()) return 'ya_enlazada';
    if (!token && !(await this.puedeEnlazar())) return 'sin_arranque';
    this.tokenArranque = token ?? null;
    try { await (await this.enlace()).credencial(); } finally { this.tokenArranque = null; }
    return 'enlazada';
  }

  /** Cliente HTTP de FacturaSIN con la credencial propia. `null` si aun no puede enlazarse. Ante 401 se re-enlaza solo UNA vez. */
  async cliente(reintentos: number): Promise<FacturaSinClient | null> {
    if (!(await this.tieneCredencial()) && !(await this.puedeEnlazar())) return null;
    const base = this.fetchConTiempo();
    const enlace = await this.enlace();
    const con401: typeof fetch = async (u, i) => {
      const r = await base(u, i);
      if (r.status !== 401) return r;
      await enlace.enlazar();
      const h = new Headers(i?.headers as ConstructorParameters<typeof Headers>[0]);
      h.set('authorization', `Bearer ${await enlace.credencial()}`);
      return base(u, { ...i, headers: h });
    };
    return new FacturaSinClient({ baseUrl: await this.urlBase(), sistema: SISTEMA, token: () => enlace.credencial(), reintentos, fetchImpl: con401 });
  }
}
