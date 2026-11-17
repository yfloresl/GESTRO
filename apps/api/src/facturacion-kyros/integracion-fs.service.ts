import { ForbiddenException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { like, sql } from 'drizzle-orm';
import { entorno } from '../config/entorno';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { BD, Bd } from '../database/database.module';
import { appConfig } from '../database/esquema';
import { FacturaSinConexion } from './facturasin-conexion';
import { asegurarWebhook, mensajeIntegracion, NUCLEO_INTEGRACION_VERSION, RegistroUrlPublica, urlPublica, urlWebhookDe, type SolicitudLike } from './nucleo/integracion';
import { fijarUrlConocida, urlPublicaConocida } from './url-publica-conocida';

export { urlPublicaConocida, origenPublicoDerivado } from './url-publica-conocida';
export const LLAVE_WEBHOOK = 'facturacion.kyros.webhook';
export const LLAVE_ENLACE = 'facturasin.enlace';
/** Prefijo del secreto de webhook POR RESTAURANTE del modelo anterior: se migra y se descarta. */
export const PREFIJO_WEBHOOK_EMISOR = 'facturacion.webhook.';
export const PREFIJO_TOKEN_EMISOR = 'facturacion.token.';

type Webhook = { estado: 'pendiente' | 'suscrito' | 'error'; url: string | null; id: string | null; error: string | null; cuando: string | null; ultimaEntrega: string | null };
type Enlace = { estado: string; error: string | null; cuando: string | null };
interface Guardado { urlPublica: string | null; urlPublicaAt: string | null; webhook: Webhook; enlace: Enlace; version: string }
const VACIO: Guardado = { urlPublica: null, urlPublicaAt: null, webhook: { estado: 'pendiente', url: null, id: null, error: null, cuando: null, ultimaEntrega: null }, enlace: { estado: 'pendiente', error: null, cuando: null }, version: NUCLEO_INTEGRACION_VERSION };

export interface EstadoIntegracion {
  version: string;
  urlPublica: string | null;
  webhook: Webhook;
  credencial: 'propia' | 'puente' | 'ninguna';
  enlace: Enlace;
  mensaje: string;
}

/** Valor efectivo de la URL publica: la derivada de las peticiones y, solo hasta la primera visita por https, la del entorno (respaldo obsoleto). */
export const urlPublicaEfectiva = (): string => urlPublicaConocida() ?? entorno.urlPublica;

/**
 * Enlace automatico con FacturaSIN (cero configuracion): URL publica derivada de cada peticion, credencial propia pedida sola, UN webhook idempotente para todas
 * las empresas (Kyros-Tech y cada restaurante). Todo el servidor, sin Kyros ID, sin contrasena, sin pegar secretos ni URLs. Estado cifrado en `app_config`.
 */
@Injectable()
export class IntegracionFacturaSinService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('IntegracionFacturaSIN');
  private readonly registro = new RegistroUrlPublica();
  private ocupado = false;
  private reloj?: NodeJS.Timeout;

  constructor(
    @Inject(ConfiguracionService) private readonly cfg: ConfiguracionService,
    @Inject(FacturaSinConexion) private readonly conexion: FacturaSinConexion,
    @Inject(BD) private readonly bd: Bd,
  ) {}

  async onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    try {
      const g = await this.cfg.leer<Guardado>(LLAVE_ENLACE);
      if (g?.urlPublica) { this.registro.fijar(g.urlPublica); fijarUrlConocida(g.urlPublica); }
    } catch { /* sin config legible el arranque sigue */ }
    setTimeout(() => void this.asegurarTodo('arranque').then(() => this.migrarEmisores()).catch(() => undefined), 20_000).unref();
    this.reloj = setInterval(() => void this.asegurarTodo('periodico'), 5 * 60_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  private async leer(): Promise<Guardado> { return { ...VACIO, ...((await this.cfg.leer<Guardado>(LLAVE_ENLACE)) ?? {}) }; }
  private async escribir(f: (g: Guardado) => Guardado) { try { await this.cfg.guardar(LLAVE_ENLACE, f(await this.leer()), null); } catch { /* informativo */ } }
  private async auditar(actor: string | null, accion: string, detalle: unknown) {
    try { await this.bd.execute(sql`INSERT INTO audit_log (user_id, action, entity, entity_id, after) VALUES (${actor}::uuid, ${accion}, 'facturasin_enlace', 'kyros', ${JSON.stringify(detalle ?? {})}::jsonb)`); } catch { /* nunca rompe */ }
  }

  /** Observa una peticion: si el dominio publico es nuevo (o cambio con umbral/administrador) lo guarda y re-asegura el webhook. Nunca lanza. */
  async observar(req: SolicitudLike, esAdmin = false): Promise<void> {
    const r = urlPublica(req, { desarrollo: !entorno.produccion });
    if (!r.ok) return;
    try {
      const o = this.registro.observar(r.base, esAdmin);
      if (!o.cambio) return;
      fijarUrlConocida(o.base);
      await this.escribir((g) => ({ ...g, urlPublica: o.base, urlPublicaAt: new Date().toISOString() }));
      void this.asegurarTodo('cambio_de_dominio');
    } catch (e) { this.log.warn(String((e as Error)?.message ?? e)); }
  }

  async estado(): Promise<EstadoIntegracion> {
    const g = await this.leer();
    const credencial = await this.conexion.tipoCredencial();
    const w = g.webhook;
    let mensaje: string;
    if (credencial === 'ninguna') mensaje = 'Falta el arranque inicial del enlace con FacturaSIN: lo completa el administrador de plataforma una sola vez con «Conectar y probar»; despues todo es automatico.';
    else if (!urlPublicaConocida()) mensaje = 'Todavia no se detecto la direccion publica del sistema: se detecta sola en la primera visita por https.';
    else if (w.estado === 'suscrito') mensaje = `Listo: FacturaSIN avisa a ${w.url}.`;
    else if (w.estado === 'error') mensaje = w.error ?? 'No se pudo suscribir el aviso; el sistema reintenta solo.';
    else mensaje = 'El aviso de estados se suscribe solo en unos segundos.';
    return { version: NUCLEO_INTEGRACION_VERSION, urlPublica: urlPublicaConocida(), webhook: w, credencial, enlace: g.enlace, mensaje };
  }

  async registrarEntrega() { await this.escribir((g) => ({ ...g, webhook: { ...g.webhook, ultimaEntrega: new Date().toISOString() } })); }

  async enlazarCredencial(actor: string | null, token?: string | null): Promise<'propia' | 'puente' | 'ninguna'> {
    try {
      const r = await this.conexion.enlazarSiFalta(token);
      if (r === 'sin_arranque') return 'ninguna';
      await this.escribir((g) => ({ ...g, enlace: { estado: 'propia', error: null, cuando: new Date().toISOString() } }));
      if (r === 'enlazada') await this.auditar(actor, 'facturacion_kyros.enlazada', { via: token ? 'administrador_plataforma' : 'automatico' });
      return 'propia';
    } catch (e) {
      await this.escribir((g) => ({ ...g, enlace: { estado: 'error', error: mensajeIntegracion(e).mensaje, cuando: new Date().toISOString() } }));
      return (await this.conexion.tieneCredencial()) ? 'propia' : 'puente';
    }
  }

  private async anotarWebhook(w: Partial<Webhook>) {
    await this.escribir((g) => ({ ...g, webhook: { ...g.webhook, ...w, cuando: new Date().toISOString() }, version: NUCLEO_INTEGRACION_VERSION }));
  }

  /** Idempotente: UNA suscripcion del sistema (todas las empresas) a la URL derivada, con el secreto de firma UNICO cifrado. No recibe la URL de nadie. */
  async asegurarWebhook(actor: string | null = null): Promise<{ ok: boolean; mensaje: string }> {
    const base = urlPublicaConocida();
    if (!base) { const m = 'Aun no se detecto la direccion publica del sistema (se detecta sola en la primera visita por https).'; await this.anotarWebhook({ estado: 'pendiente', error: m }); return { ok: false, mensaje: m }; }
    if (!(await this.conexion.conectada()) && !(await this.conexion.puedeEnlazar())) { const m = mensajeIntegracion({ codigo: 'NO_CONFIGURADO' }).mensaje; await this.anotarWebhook({ estado: 'pendiente', error: m }); return { ok: false, mensaje: m }; }
    try {
      const url = urlWebhookDe(base);
      const previos = (await this.cfg.leer<{ secretos: string[] }>(LLAVE_WEBHOOK))?.secretos ?? [];
      const r = await asegurarWebhook(await this.conexion.enlace(), { url, secretoGuardado: previos.length > 0 });
      if (r.secreto) await this.cfg.guardar(LLAVE_WEBHOOK, { secretos: [r.secreto, ...previos].slice(0, 2) }, null);
      await this.anotarWebhook({ estado: 'suscrito', url, id: r.id, error: null });
      if (r.accion !== 'sin_cambios') await this.auditar(actor, 'facturacion_kyros.webhook_asegurado', { url, accion: r.accion });
      return { ok: true, mensaje: r.accion === 'sin_cambios' ? 'El aviso ya estaba suscrito a la direccion actual.' : r.accion === 'actualizado' ? 'El aviso se movio solo a la direccion actual del sistema.' : 'Aviso de estados suscrito.' };
    } catch (e) {
      const m = mensajeIntegracion(e).mensaje;
      await this.anotarWebhook({ estado: 'error', error: m });
      return { ok: false, mensaje: m };
    }
  }

  /**
   * MIGRACION idempotente al modelo unico: cada restaurante ya configurado se asegura como empresa `gestro:<id>` en FacturaSIN (sin credenciales nuevas) y se descartan
   * sus secretos locales viejos (token delegado y secreto de webhook por restaurante). Sin pasos manuales; no toca facturas.
   */
  async migrarEmisores(): Promise<number> {
    if (!(await this.conexion.conectada())) return 0;
    const filas = await this.bd.select({ clave: appConfig.clave }).from(appConfig).where(like(appConfig.clave, `${PREFIJO_WEBHOOK_EMISOR}%`));
    let n = 0;
    for (const f of filas.slice(0, 50)) {
      const rid = f.clave.slice(PREFIJO_WEBHOOK_EMISOR.length);
      if (!/^[0-9a-f-]{36}$/i.test(rid)) continue;
      try {
        const c = (await this.bd.execute(sql`SELECT nit, legal_name, municipality, address FROM billing_settings WHERE restaurant_id = ${rid}::uuid`)).rows[0] as { nit: string; legal_name: string; municipality: string; address: string } | undefined;
        if (c) await (await this.conexion.enlace()).asegurarEmpresa(rid, { nit: c.nit, razonSocial: c.legal_name, municipio: c.municipality, direccion: c.address });
        await this.bd.execute(sql`DELETE FROM app_config WHERE clave IN (${PREFIJO_WEBHOOK_EMISOR + rid}, ${PREFIJO_TOKEN_EMISOR + rid})`);
        await this.bd.execute(sql`UPDATE billing_settings SET connected_at = COALESCE(connected_at, now()), webhook_set = false WHERE restaurant_id = ${rid}::uuid`);
        n++;
      } catch (e) { this.log.warn(`migracion de un restaurante pendiente: ${mensajeIntegracion(e).mensaje}`); }
    }
    return n;
  }

  /** Conciliacion periodica y a pedido: credencial propia + webhook unico. Nunca lanza. */
  async asegurarTodo(motivo: string, actor: string | null = null, token?: string | null): Promise<{ ok: boolean; mensaje: string }> {
    if (this.ocupado) return { ok: true, mensaje: 'Ya hay una verificacion en curso.' };
    this.ocupado = true;
    try {
      await this.enlazarCredencial(actor, token);
      return await this.asegurarWebhook(actor);
    } catch (e) {
      this.log.warn(`${motivo}: ${String((e as Error)?.message ?? e)}`);
      return { ok: false, mensaje: mensajeIntegracion(e).mensaje };
    } finally { this.ocupado = false; }
  }

  /** «Verificar / Conectar y probar» del SuperAdmin de plataforma: sin contrasena ni URL; `token` (administrador de plataforma, opcional) solo para el primer enlace. */
  async verificar(actor: string, esSuperAdmin: boolean, token?: string | null) {
    if (!esSuperAdmin) throw new ForbiddenException('Solo el SuperAdmin de la plataforma puede verificar la integracion.');
    const r = await this.asegurarTodo('manual', actor, token);
    return { ...r, estado: await this.estado() };
  }
}
