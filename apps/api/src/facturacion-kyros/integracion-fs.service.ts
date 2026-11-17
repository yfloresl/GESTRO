import { ForbiddenException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { like, sql } from 'drizzle-orm';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { entorno } from '../config/entorno';
import { BD, Bd } from '../database/database.module';
import { appConfig } from '../database/esquema';
import { IntegracionesService } from '../integraciones/integraciones';
import { EMISOR_POR_DEFECTO, KyrosIdService } from '../kyros-id/kyros-id.service';
import { CONVENCION } from './integracion/convencion';
import { enlazarSistema, puertoWebhooks } from './integracion/enlace';
import { urlPublicaValida } from './integracion/url-publica';
import { esDesarrollo, fijarUrlConocida, onCambioDeUrl, urlPublicaConocida } from './integracion/url-publica-estado';
import { INTEGRACION_FS_VERSION } from './integracion/version';
import { asegurarWebhookCon, mensajeWebhook, type PuertoWebhooks } from './integracion/webhook';
import { FacturaSinClient, tokenClientCredentials } from './nucleo';

export { urlPublica, urlPublicaConocida, urlPublicaMiddleware, origenPublicoDerivado } from './integracion/url-publica-estado';
export const SISTEMA = 'gestro';
export const LLAVE_CONFIG = 'facturacion.kyros';
export const LLAVE_WEBHOOK = 'facturacion.kyros.webhook';
export const LLAVE_ENLACE = 'facturasin.enlace';
export const PREFIJO_WEBHOOK_EMISOR = 'facturacion.webhook.';
export const RUTA_WEBHOOK_KYROS = '/api/v1/webhooks/facturasin';
export const rutaWebhookEmisor = (restaurantId: string) => `/api/v1/public/facturasin/webhook/${restaurantId}`;
export const TIEMPO_LLAMADA_MS = 10_000;

type Webhook = { estado: 'pendiente' | 'suscrito' | 'error'; url: string | null; id: string | null; error: string | null; cuando: string | null; ultimaEntrega: string | null };
type Enlace = { estado: string; error: string | null; cuando: string | null };
interface Guardado { urlPublica: string | null; urlPublicaAt: string | null; webhook: Webhook; enlace: Enlace; version: string }
const VACIO: Guardado = { urlPublica: null, urlPublicaAt: null, webhook: { estado: 'pendiente', url: null, id: null, error: null, cuando: null, ultimaEntrega: null }, enlace: { estado: 'pendiente', error: null, cuando: null }, version: INTEGRACION_FS_VERSION };

export interface EstadoIntegracion {
  version: string;
  urlPublica: string | null;
  webhook: Webhook;
  credencial: 'propia' | 'puente' | 'ninguna';
  enlace: Enlace;
  mensaje: string;
}

/** Valor efectivo de la URL publica del sistema: la derivada de las peticiones y, solo hasta la primera visita por https, la del entorno (respaldo obsoleto). */
export const urlPublicaEfectiva = (): string => urlPublicaConocida() ?? entorno.urlPublica;

/**
 * R2/R4: enlace automatico con FacturaSIN. SIN Kyros ID, SIN contrasena, SIN pegar secretos ni URLs: el servidor usa su credencial de servicio.
 * Se ejecuta al arrancar, al detectar un cambio de dominio, en la conciliacion periodica y a pedido del SuperAdmin («Verificar / Reintentar»).
 * El estado (url publica, webhook, enlace) vive cifrado en `app_config` (sin migracion).
 */
@Injectable()
export class IntegracionFacturaSinService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('IntegracionFacturaSIN');
  private ocupado = false;
  private reloj?: NodeJS.Timeout;
  private tokenFn?: { huella: string; fn: () => Promise<string> };

  constructor(
    @Inject(ConfiguracionService) private readonly cfg: ConfiguracionService,
    @Inject(IntegracionesService) private readonly integ: IntegracionesService,
    @Inject(KyrosIdService) private readonly kid: KyrosIdService,
    @Inject(BD) private readonly bd: Bd,
  ) {}

  async onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    try {
      const g = await this.cfg.leer<Guardado>(LLAVE_ENLACE);
      if (g?.urlPublica && !urlPublicaConocida() && urlPublicaValida(g.urlPublica, { desarrollo: esDesarrollo() })) fijarUrlConocida(g.urlPublica);
    } catch { /* sin config legible el arranque sigue */ }
    onCambioDeUrl((url) => void this.alCambioDeUrl(url));
    setTimeout(() => void this.asegurarTodo('arranque'), 20_000).unref();
    this.reloj = setInterval(() => void this.asegurarTodo('periodico'), 5 * 60_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  private async leer(): Promise<Guardado> { return { ...VACIO, ...((await this.cfg.leer<Guardado>(LLAVE_ENLACE)) ?? {}) }; }
  private async escribir(f: (g: Guardado) => Guardado) { try { await this.cfg.guardar(LLAVE_ENLACE, f(await this.leer()), null); } catch { /* informativo */ } }
  private async auditar(actor: string | null, accion: string, detalle: unknown) {
    try { await this.bd.execute(sql`INSERT INTO audit_log (user_id, action, entity, entity_id, after) VALUES (${actor}::uuid, ${accion}, 'facturasin_enlace', 'kyros', ${JSON.stringify(detalle ?? {})}::jsonb)`); } catch { /* nunca rompe */ }
  }

  private async alCambioDeUrl(url: string) {
    await this.escribir((g) => ({ ...g, urlPublica: url, urlPublicaAt: new Date().toISOString() }));
    await this.asegurarTodo('cambio_de_dominio');
  }

  /* ---------------- cliente (credencial propia o puente) ---------------- */

  async tipoCredencial(): Promise<'propia' | 'puente' | 'ninguna'> {
    if (await this.integ.obtener('FACTURASIN_API_KEY')) return 'propia';
    return (await this.integ.obtener('KYROS_SERVICE_CLIENT_SECRET')) ? 'puente' : 'ninguna';
  }

  /** Cliente de FacturaSIN con la credencial propia (`fsk_...`) y, si aun no la hay, con la puente de Keycloak. `null` si no hay ninguna. */
  async cliente(reintentos = 1, soloPuente = false): Promise<FacturaSinClient | null> {
    const c = (await this.cfg.leer<{ url?: string; clientId?: string; issuer?: string | null }>(LLAVE_CONFIG)) ?? {};
    const baseUrl = c.url || CONVENCION.urlFacturaSin;
    const conTiempo: typeof fetch = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(TIEMPO_LLAMADA_MS) });
    const propia = soloPuente ? null : await this.integ.obtener('FACTURASIN_API_KEY');
    if (propia) return new FacturaSinClient({ baseUrl, sistema: SISTEMA, token: async () => propia, reintentos, fetchImpl: conTiempo });
    const secreto = await this.integ.obtener('KYROS_SERVICE_CLIENT_SECRET');
    if (!secreto) return null;
    const issuer = c.issuer || (await this.kid.ajustes()).emisor || EMISOR_POR_DEFECTO;
    const clientId = c.clientId || CONVENCION.clienteServicio(SISTEMA);
    const huella = `${issuer}|${clientId}|${secreto.length}|${secreto.slice(-4)}`;
    if (this.tokenFn?.huella !== huella) this.tokenFn = { huella, fn: tokenClientCredentials({ issuer, clientId, clientSecret: secreto, fetchImpl: conTiempo }) };
    return new FacturaSinClient({ baseUrl, sistema: SISTEMA, token: this.tokenFn.fn, reintentos, fetchImpl: conTiempo });
  }

  /* ---------------- estado ---------------- */

  async estado(): Promise<EstadoIntegracion> {
    const g = await this.leer();
    const credencial = await this.tipoCredencial();
    const w = g.webhook;
    let mensaje: string;
    if (credencial === 'ninguna') mensaje = 'Falta la credencial de servicio de GESTRO para hablar con FacturaSIN. La coloca el despliegue una sola vez; el resto se configura solo.';
    else if (!urlPublicaConocida()) mensaje = 'Todavia no se detecto la direccion publica del sistema: se detecta sola en la primera visita por https.';
    else if (w.estado === 'suscrito') mensaje = `Listo: FacturaSIN avisa a ${w.url}.`;
    else if (w.estado === 'error') mensaje = w.error ?? 'No se pudo suscribir el aviso; el sistema reintenta solo.';
    else mensaje = 'El aviso de estados se suscribe solo en unos segundos.';
    return { version: INTEGRACION_FS_VERSION, urlPublica: urlPublicaConocida(), webhook: w, credencial, enlace: g.enlace, mensaje };
  }

  /** Se llama desde el webhook firmado valido (de Kyros o de un restaurante): guarda la hora de la ultima entrega. */
  async registrarEntrega() { await this.escribir((g) => ({ ...g, webhook: { ...g.webhook, ultimaEntrega: new Date().toISOString() } })); }

  /* ---------------- R4: credencial propia sin Keycloak ---------------- */

  async enlazarCredencial(actor: string | null): Promise<'propia' | 'puente' | 'ninguna'> {
    const actual = await this.tipoCredencial();
    if (actual === 'propia' || actual === 'ninguna') return actual;
    try {
      const puente = await this.cliente(1, true);
      if (!puente) return 'ninguna';
      const r = await enlazarSistema((m, ruta, o) => puente.llamar(m, ruta, o), { sistema: SISTEMA, dominioPublico: urlPublicaConocida() ?? undefined, version: INTEGRACION_FS_VERSION });
      if (r?.credencial) {
        await this.integ.guardarDeServicio('FACTURASIN_API_KEY', r.credencial.valor);
        await this.escribir((g) => ({ ...g, enlace: { estado: 'propia', error: null, cuando: new Date().toISOString() } }));
        await this.auditar(actor, 'facturacion_kyros.enlace_credencial', { prefijo: r.credencial.prefijo });
        return 'propia';
      }
      await this.escribir((g) => ({ ...g, enlace: { estado: 'puente', error: null, cuando: new Date().toISOString() } }));
    } catch (e) {
      await this.escribir((g) => ({ ...g, enlace: { estado: 'puente', error: mensajeWebhook(e), cuando: new Date().toISOString() } }));
    }
    return 'puente';
  }

  /* ---------------- R2: webhook automatico ---------------- */

  private async anotarWebhook(w: Partial<Webhook>) {
    await this.escribir((g) => ({ ...g, webhook: { ...g.webhook, ...w, cuando: new Date().toISOString() }, version: INTEGRACION_FS_VERSION }));
  }

  /**
   * Idempotente: deja UNA suscripcion del webhook de Kyros (Flujo 1) con la URL publica derivada y el secreto de firma cifrado. No recibe la URL de nadie:
   * un SuperAdmin no puede desviar el aviso a otro dominio (la unica URL posible es la derivada de las propias peticiones al sistema).
   */
  async asegurarWebhook(actor: string | null = null): Promise<{ ok: boolean; mensaje: string }> {
    const base = urlPublicaConocida();
    if (!base) { const m = 'Aun no se detecto la direccion publica del sistema (se detecta sola en la primera visita por https).'; await this.anotarWebhook({ estado: 'pendiente', error: m }); return { ok: false, mensaje: m }; }
    const cliente = await this.cliente(1);
    if (!cliente) { const m = 'Falta la credencial de servicio de GESTRO ante FacturaSIN.'; await this.anotarWebhook({ estado: 'pendiente', error: m }); return { ok: false, mensaje: m }; }
    if (!urlPublicaValida(base, { desarrollo: esDesarrollo() })) { const m = 'La direccion detectada no es publica (https): FacturaSIN no podria avisar.'; await this.anotarWebhook({ estado: 'error', error: m }); return { ok: false, mensaje: m }; }
    const destino = `${base}${RUTA_WEBHOOK_KYROS}`;
    try {
      const empresa = ((await this.cfg.leer<{ empresa?: string }>(LLAVE_CONFIG))?.empresa) || CONVENCION.tenantKyros;
      const puerto = puertoWebhooks((m, ruta, o) => cliente.llamar(m, ruta, o), cliente.cabEmpresa(empresa)['X-Empresa-Externa']!);
      const g = await this.leer();
      const previos = (await this.cfg.leer<{ secretos: string[] }>(LLAVE_WEBHOOK))?.secretos ?? [];
      const r = await asegurarWebhookCon(puerto, { tenantId: empresa, urlDestino: destino, local: { url: g.webhook.url, id: g.webhook.id, tieneSecreto: previos.length > 0 } });
      if (r.secretoNuevo) await this.cfg.guardar(LLAVE_WEBHOOK, { secretos: [r.secretoNuevo, ...previos].slice(0, 2) }, null);
      await this.anotarWebhook({ estado: 'suscrito', url: destino, id: r.id, error: null });
      if (r.accion !== 'sin_cambios') await this.auditar(actor, 'facturacion_kyros.webhook_asegurado', { url: destino, accion: r.accion, via: r.via });
      return { ok: true, mensaje: r.accion === 'sin_cambios' ? 'El aviso ya estaba suscrito a la direccion actual.' : r.accion === 'migrada' ? 'El aviso se movio solo a la nueva direccion del sistema.' : 'Aviso de estados suscrito.' };
    } catch (e) {
      const m = mensajeWebhook(e);
      await this.anotarWebhook({ estado: 'error', error: m });
      return { ok: false, mensaje: m };
    }
  }

  /**
   * Webhooks de cada restaurante (Flujo 2): cada uno conserva SU secreto de firma, por eso solo se usa la API clasica (crear + borrar). Los que quedaron
   * suscritos a un dominio viejo (o sin URL guardada) migran solos aqui.
   */
  async asegurarWebhooksEmisores(): Promise<number> {
    const base = urlPublicaConocida();
    if (!base) return 0;
    const cliente = await this.cliente(1);
    if (!cliente) return 0;
    const filas = await this.bd.select({ clave: appConfig.clave }).from(appConfig).where(like(appConfig.clave, `${PREFIJO_WEBHOOK_EMISOR}%`));
    let migrados = 0;
    for (const f of filas.slice(0, 50)) {
      const rid = f.clave.slice(PREFIJO_WEBHOOK_EMISOR.length);
      if (!/^[0-9a-f-]{36}$/i.test(rid)) continue;
      try {
        const actual = await this.cfg.leer<{ secretos: string[]; url?: string }>(f.clave);
        if (!actual?.secretos?.length || actual.url?.startsWith(`${base}/`)) continue;
        const destino = `${base}${rutaWebhookEmisor(rid)}`;
        const clasico: PuertoWebhooks = { ...puertoWebhooks((m, ruta, o) => cliente.llamar(m, ruta, o), cliente.cabEmpresa(rid)['X-Empresa-Externa']!), async upsert() { return null; } };
        const r = await asegurarWebhookCon(clasico, { tenantId: rid, urlDestino: destino, local: { url: actual.url ?? null, id: null, tieneSecreto: true } });
        await this.cfg.guardar(f.clave, { secretos: r.secretoNuevo ? [r.secretoNuevo] : actual.secretos, url: destino }, null);
        migrados++;
      } catch (e) { this.log.warn(`webhook de un restaurante no migrado: ${mensajeWebhook(e)}`); }
    }
    return migrados;
  }

  /** Conciliacion periodica y a pedido: credencial propia, webhook de Kyros y webhooks de restaurantes. Nunca lanza. */
  async asegurarTodo(motivo: string, actor: string | null = null): Promise<{ ok: boolean; mensaje: string }> {
    if (this.ocupado) return { ok: true, mensaje: 'Ya hay una verificacion en curso.' };
    this.ocupado = true;
    try {
      await this.enlazarCredencial(actor);
      const w = await this.asegurarWebhook(actor);
      await this.asegurarWebhooksEmisores().catch(() => 0);
      return w;
    } catch (e) {
      this.log.warn(`${motivo}: ${String((e as Error)?.message ?? e)}`);
      return { ok: false, mensaje: mensajeWebhook(e) };
    } finally { this.ocupado = false; }
  }

  /** Accion del SuperAdmin de plataforma: «Verificar / Reintentar». Sin contrasena ni URL: solo dispara lo mismo que hace el sistema solo. */
  async verificar(actor: string, esSuperAdmin: boolean) {
    if (!esSuperAdmin) throw new ForbiddenException('Solo el SuperAdmin de la plataforma puede verificar la integracion.');
    const r = await this.asegurarTodo('manual', actor);
    return { ...r, estado: await this.estado() };
  }
}
