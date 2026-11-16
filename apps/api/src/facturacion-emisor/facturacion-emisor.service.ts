import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { destinosFacturasin } from '../config/entorno';
import { Bd, BD, Tenant, TenantDb } from '../database/database.module';
import { IntegracionesService } from '../integraciones/integraciones';
import {
  armarComprador, armarPayload, calcularFactura, CompradorSalida, CONSUMIDOR_FINAL, deCentavos, ErrorFactura, esperaDeReintento, estadoLocal, idExternoDe,
  CODIGOS_PAGO_POR_DEFECTO, CodigosPago, LineaPedido, limpiarTexto, PayloadFactura, tarjetaEnmascarada, TIPOS_DOCUMENTO, validarNit,
} from './calculo-factura';
import { evaluarRegimenFiscal, TEXTO_AVISO_CODIGOS } from '../facturacion-kyros/nucleo/normativa';
import { Factura, FacturaSinClient, FacturaSinError, tokenClientCredentials, verificarFirmaWebhook } from './facturasin-client';

/* ------------------------------------------------------------------ esquemas ------------------------------------------------------------------ */

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Fecha inválida');
export const ConfigFacturacion = z.object({
  nit: z.string().trim(),
  razonSocial: z.string(),
  actividades: z.array(z.string().trim().regex(/^\d{4,8}$/, 'Cada actividad económica es un código numérico del SIN (4 a 8 dígitos).')).min(1, 'Indica al menos una actividad económica.').max(10),
  sucursal: z.number().int().min(0).max(9999), puntoVenta: z.number().int().min(0).max(9999),
  municipio: z.string(), direccion: z.string(), leyenda: z.string().max(300).nullable().optional(),
  modalidad: z.enum(['simulado', 'real']).default('simulado'),
  codigoSinPorDefecto: z.string().trim().regex(/^\d{3,10}$/, 'El código de producto SIN por defecto es numérico.'),
  unidadPorDefecto: z.number().int().min(1).max(999).default(57),
  permiteConsumidorFinal: z.boolean().default(true), habilitada: z.boolean().default(true),
  /** F10: régimen declarado (solo avisa; el Simplificado no puede emitir factura con crédito fiscal). */
  regimen: z.enum(['general', 'simplificado', 'no_declarado']).default('no_declarado'),
  /** Códigos del catálogo `metodoPago` de FacturaSIN por método de cobro (configuración, no constantes). */
  codigosPago: z.object({ efectivo: z.number().int().min(1).max(999), tarjeta: z.number().int().min(1).max(999), otro: z.number().int().min(1).max(999) }).default({ efectivo: 1, tarjeta: 2, otro: 7 }),
  codigosConfirmados: z.boolean().default(false),
  /** Solo escritura: nunca se devuelve. */
  tokenDelegado: z.string().min(10, 'El token delegado parece incompleto.').max(4000).optional(),
  tokenVenceEn: Fecha.nullable().optional(), quitarToken: z.boolean().optional(),
}).strict();

export const DatosComprador = z.object({
  tipo: z.enum(['nit', 'ci', 'cex', 'pasaporte', 'otro']), numero: z.string().max(30), complemento: z.string().max(10).optional(),
  razonSocial: z.string().max(300), correo: z.string().max(200).optional(), nitConExcepcion: z.boolean().optional(),
}).strict();
export const Facturar = z.object({
  comprador: DatosComprador.optional(), consumidorFinal: z.boolean().optional(),
  tarjeta: z.object({ primeros4: z.string(), ultimos4: z.string() }).strict().optional(),
}).strict();
export type FacturarDatos = z.infer<typeof Facturar>;
export const AnularFactura = z.object({ motivo: z.number().int().min(1).max(20), comentario: z.string().trim().min(3, 'Escribe el motivo (mínimo 3 letras).').max(300) }).strict();

export const VIVAS = ['en_cola', 'pendiente', 'validada', 'observada', 'contingencia'] as const;
const AVISO_PRUEBAS = 'Ambiente de pruebas / sin validez fiscal';
const CLAVE_TOKEN = (rid: string) => `facturacion.token.${rid}`;
const CLAVE_WEBHOOK = (rid: string) => `facturacion.webhook.${rid}`;

interface Fila {
  id: string; restaurant_id: string; order_id: string; payment_id: string; attempt: number; external_id: string; status: string;
  buyer_doc_type: number; buyer_doc_number: string; buyer_complement: string | null; buyer_name: string; buyer_email: string | null; final_consumer: boolean;
  subtotal: string; discount: string; total: string; iva_ref: string; tip_excluded: string; payload: PayloadFactura;
  fs_invoice_id: string | null; invoice_number: string | null; cuf: string | null; issued_at: Date | string | null; fs_total: string | null; fs_iva: string | null;
  qr_text: string | null; notice: string | null; test_env: boolean; errors: unknown; last_error: string | null; tries: number; next_retry_at: Date | string | null; last_event_at: Date | string | null;
  void_code: number | null; void_reason: string | null; voided_at: Date | string | null; created_at: Date | string;
}
const COLUMNAS = sql.raw(`id, restaurant_id, order_id, payment_id, attempt, external_id, status, buyer_doc_type, buyer_doc_number, buyer_complement, buyer_name, buyer_email, final_consumer,
  subtotal::text, discount::text, total::text, iva_ref::text, tip_excluded::text, payload, fs_invoice_id, invoice_number::text, cuf, issued_at, fs_total::text, fs_iva::text,
  qr_text, notice, test_env, errors, last_error, tries, next_retry_at, last_event_at, void_code, void_reason, voided_at, created_at`);

/** El driver entrega las fechas de `execute` como texto: se aceptan texto o Date. */
const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);

export function vistaFactura(f: Fila) {
  return {
    id: f.id, pedidoId: f.order_id, intento: f.attempt, estado: f.status, pendienteDeEmitir: f.status === 'en_cola',
    comprador: { tipoDocumento: f.buyer_doc_type, numeroDocumento: f.buyer_doc_number, complemento: f.buyer_complement, razonSocial: f.buyer_name, correo: f.buyer_email, consumidorFinal: f.final_consumer },
    subtotal: f.subtotal, descuento: f.discount, total: f.total, ivaReferencial: f.iva_ref, propinaNoFacturada: f.tip_excluded,
    numero: f.invoice_number ? Number(f.invoice_number) : null, cuf: f.cuf, emitida: iso(f.issued_at), qrTexto: f.qr_text,
    aviso: f.test_env ? (f.notice ?? AVISO_PRUEBAS) : f.notice, ambientePruebas: f.test_env, puedeImprimir: !!f.fs_invoice_id,
    error: f.last_error, errores: f.errors, reintentos: f.tries, proximoReintento: iso(f.next_retry_at),
    anulacion: f.status === 'anulada' ? { motivo: f.void_reason, codigo: f.void_code, cuando: iso(f.voided_at) } : null, creada: iso(f.created_at)!,
  };
}

/** Errores de FacturaSIN que no se arreglan reintentando: hay que corregir la configuración (credenciales, empresa, permisos). */
const ERRORES_DE_CONFIGURACION = new Set(['NO_AUTENTICADO', 'SIN_PERMISO', 'EMPRESA_NO_ENCONTRADA', 'EMPRESA_BLOQUEADA', 'CREDENCIAL_FALTANTE', 'TOKEN_VENCIDO', 'USUARIO_NO_VINCULADO']);

@Injectable()
export class FacturacionEmisorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Facturacion');
  private reloj?: NodeJS.Timeout;
  private tokenFn?: { huella: string; fn: () => Promise<string> };

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb, @Inject(BD) private readonly bd: Bd,
    @Inject(ConfiguracionService) private readonly cfg: ConfiguracionService, @Inject(IntegracionesService) private readonly integ: IntegracionesService,
  ) {}

  /** Cola de reintentos y conciliación de pendientes: cada minuto. La venta nunca depende de este proceso. */
  onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    this.reloj = setInterval(() => { void this.procesarPendientes().catch((e) => this.log.error(`Cola de facturas: ${(e as Error).message}`)); }, 60_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /* ------------------------------------------------------------- cliente FacturaSIN ------------------------------------------------------------- */

  private async cliente(reintentos: number): Promise<FacturaSinClient> {
    const secreto = await this.integ.obtener('KYROS_SERVICE_CLIENT_SECRET');
    if (!secreto) throw new ServiceUnavailableException({ code: 'SIN_CREDENCIAL_DE_SERVICIO', message: 'Falta la credencial de GESTRO ante FacturaSIN (secreto del client gestro-service). La carga el equipo de plataforma en Integraciones.' });
    const d = destinosFacturasin();
    const conTiempo: typeof fetch = (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(10_000) });
    const huella = createHash('sha256').update(`${d.emisor}|${d.clientId}|${secreto}`).digest('hex');
    if (this.tokenFn?.huella !== huella) this.tokenFn = { huella, fn: tokenClientCredentials({ issuer: d.emisor, clientId: d.clientId, clientSecret: secreto, fetchImpl: conTiempo }) };
    return new FacturaSinClient({ baseUrl: d.api, sistema: 'gestro', token: this.tokenFn.fn, reintentos, fetchImpl: conTiempo });
  }

  /* ------------------------------------------------------------------ configuración ------------------------------------------------------------------ */

  private vistaConfig(c: Record<string, unknown>) {
    return {
      configurada: true, nit: c.nit, razonSocial: c.legal_name, actividades: c.economic_activities, sucursal: c.branch_code, puntoVenta: c.pos_code, municipio: c.municipality, direccion: c.address,
      leyenda: c.legend ?? null, modalidad: c.mode, codigoSinPorDefecto: c.default_sin_product_code, unidadPorDefecto: c.default_unit_code, permiteConsumidorFinal: c.allow_final_consumer, habilitada: c.enabled,
      tokenRegistrado: c.token_set, tokenVenceEn: c.token_expires_on ?? null, webhookRegistrado: c.webhook_set, conectadoEn: c.connected_at ?? null,
      ultimaPrueba: c.last_test_at ? { cuando: c.last_test_at, ok: c.last_test_ok, mensaje: c.last_test_message } : null,
      ambientePruebas: c.mode !== 'real', aviso: c.mode !== 'real' ? AVISO_PRUEBAS : null,
      regimen: c.tax_regime ?? 'no_declarado', avisosRegimen: evaluarRegimenFiscal({ regimen: c.tax_regime as string, nit: c.nit as string }).avisos,
      codigosPago: c.payment_codes ?? CODIGOS_PAGO_POR_DEFECTO, codigosConfirmados: c.codes_confirmed === true, avisoCodigos: c.codes_confirmed === true ? null : TEXTO_AVISO_CODIGOS,
    };
  }

  async config(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const c = (await tx.execute(sql`SELECT nit, legal_name, economic_activities, branch_code, pos_code, municipality, address, legend, mode, default_sin_product_code, default_unit_code, allow_final_consumer, enabled, tax_regime, payment_codes, codes_confirmed,
        token_set, token_expires_on::text AS token_expires_on, webhook_set, connected_at, last_test_at, last_test_ok, last_test_message FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as Record<string, unknown> | undefined;
      if (c) return this.vistaConfig(c);
      const [a] = (await tx.execute(sql`SELECT a.legal_name, a.nit FROM restaurants r JOIN accounts a ON a.id = r.account_id WHERE r.id = ${t.restaurantId}`)).rows as { legal_name: string; nit: string | null }[];
      return { configurada: false, sugerencia: { nit: a?.nit ?? '', razonSocial: a?.legal_name ?? '' }, modalidad: 'simulado', ambientePruebas: true, aviso: AVISO_PRUEBAS, unidadPorDefecto: 57, permiteConsumidorFinal: true, habilitada: true, sucursal: 0, puntoVenta: 0 };
    });
  }

  /** Lo mínimo que necesita Caja para decidir si ofrece «Facturar» (lo lee cualquier rol de cobro). */
  async estado(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const c = (await tx.execute(sql`SELECT enabled, mode, allow_final_consumer FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as { enabled: boolean; mode: string; allow_final_consumer: boolean } | undefined;
      const p = (await tx.execute(sql`SELECT count(*)::int AS n FROM fiscal_invoices WHERE restaurant_id = ${t.restaurantId} AND status = 'en_cola'`)).rows[0] as { n: number };
      return { disponible: !!c?.enabled, ambientePruebas: !c || c.mode !== 'real', aviso: c && c.mode === 'real' ? null : AVISO_PRUEBAS, permiteConsumidorFinal: c?.allow_final_consumer ?? false, pendientesDeEmitir: p.n };
    });
  }

  async guardarConfig(t: Tenant, userId: string, cuerpo: unknown) {
    const d = ConfigFacturacion.parse(cuerpo);
    let v;
    try {
      v = {
        nit: validarNit(d.nit), razonSocial: limpiarTexto(d.razonSocial, 'Razón social', 2, 200), municipio: limpiarTexto(d.municipio, 'Municipio', 2, 100), direccion: limpiarTexto(d.direccion, 'Dirección', 3, 300),
        leyenda: d.leyenda?.trim() ? limpiarTexto(d.leyenda, 'Leyenda', 3, 300) : null,
      };
    } catch (e) { if (e instanceof ErrorFactura) throw new UnprocessableEntityException(e.message); throw e; }
    if (d.modalidad === 'real') throw new UnprocessableEntityException('La facturación real todavía no está disponible: se habilita cuando el SIN autorice el sistema. Por ahora todo es ambiente de pruebas.');
    // Un mismo NIT no puede ser reclamado por dos cuentas distintas de GESTRO (evita facturar a nombre de otro).
    const otra = (await this.bd.execute(sql`SELECT 1 FROM billing_settings b JOIN restaurants r ON r.id = b.restaurant_id JOIN restaurants mi ON mi.id = ${t.restaurantId}
      WHERE b.nit = ${v.nit} AND b.restaurant_id <> ${t.restaurantId} AND r.account_id <> mi.account_id`)).rows;
    if (otra.length) throw new ConflictException('Ese NIT ya está registrado por otra cuenta de GESTRO. Si es tuyo, escribe a administracion@kyros-tech.com.');
    await this.db.run(t, async (tx) => {
      await tx.execute(sql`INSERT INTO billing_settings (restaurant_id, nit, legal_name, economic_activities, branch_code, pos_code, municipality, address, legend, mode, default_sin_product_code, default_unit_code, allow_final_consumer, enabled, tax_regime, payment_codes, codes_confirmed, updated_by)
        VALUES (${t.restaurantId}, ${v.nit}, ${v.razonSocial}, ${`{${d.actividades.join(',')}}`}::text[], ${d.sucursal}, ${d.puntoVenta}, ${v.municipio}, ${v.direccion}, ${v.leyenda}, 'simulado', ${d.codigoSinPorDefecto}, ${d.unidadPorDefecto}, ${d.permiteConsumidorFinal}, ${d.habilitada}, ${d.regimen}, ${JSON.stringify(d.codigosPago)}::jsonb, ${d.codigosConfirmados}, ${userId}::uuid)
        ON CONFLICT (restaurant_id) DO UPDATE SET nit = EXCLUDED.nit, legal_name = EXCLUDED.legal_name, economic_activities = EXCLUDED.economic_activities, branch_code = EXCLUDED.branch_code, pos_code = EXCLUDED.pos_code,
          municipality = EXCLUDED.municipality, address = EXCLUDED.address, legend = EXCLUDED.legend, mode = EXCLUDED.mode, default_sin_product_code = EXCLUDED.default_sin_product_code, default_unit_code = EXCLUDED.default_unit_code,
          allow_final_consumer = EXCLUDED.allow_final_consumer, enabled = EXCLUDED.enabled, tax_regime = EXCLUDED.tax_regime, payment_codes = EXCLUDED.payment_codes, codes_confirmed = EXCLUDED.codes_confirmed, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      // Cambiar el NIT invalida la conexión anterior: hay que volver a conectar.
      await tx.execute(sql`UPDATE billing_settings SET connected_at = NULL WHERE restaurant_id = ${t.restaurantId} AND nit <> ${v.nit}`);
      await auditar(tx, t.restaurantId, userId, 'facturacion.config_guardada', 'billing_settings', t.restaurantId, { nit: v.nit, actividades: d.actividades, sucursal: d.sucursal, puntoVenta: d.puntoVenta, habilitada: d.habilitada, tokenNuevo: !!d.tokenDelegado });
    });
    if (d.tokenDelegado) {
      await this.cfg.guardar(CLAVE_TOKEN(t.restaurantId), { valor: d.tokenDelegado, actualizado: new Date().toISOString() }, userId);
      await this.db.run(t, (tx) => tx.execute(sql`UPDATE billing_settings SET token_set = true, token_updated_at = now(), token_expires_on = ${d.tokenVenceEn ?? null}::date WHERE restaurant_id = ${t.restaurantId}`));
    } else if (d.quitarToken) {
      await this.cfg.guardar(CLAVE_TOKEN(t.restaurantId), { valor: null, actualizado: new Date().toISOString() }, userId);   // se limpia el valor; el registro queda
      await this.db.run(t, async (tx) => { await tx.execute(sql`UPDATE billing_settings SET token_set = false, token_expires_on = NULL WHERE restaurant_id = ${t.restaurantId}`); await auditar(tx, t.restaurantId, userId, 'facturacion.token_quitado', 'billing_settings', t.restaurantId); });
    } else if (d.tokenVenceEn !== undefined) {
      await this.db.run(t, (tx) => tx.execute(sql`UPDATE billing_settings SET token_expires_on = ${d.tokenVenceEn}::date WHERE restaurant_id = ${t.restaurantId}`));
    }
    return this.config(t);
  }

  private async ajustes(t: Tenant) {
    const c = await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT nit, legal_name, economic_activities, branch_code, pos_code, municipality, address, default_sin_product_code, default_unit_code, allow_final_consumer, enabled FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as
      { nit: string; legal_name: string; economic_activities: string[]; branch_code: number; pos_code: number; municipality: string; address: string; default_sin_product_code: string; default_unit_code: number; allow_final_consumer: boolean; enabled: boolean } | undefined);
    return c ?? null;
  }

  /* ------------------------------------------------------------------ conexión ------------------------------------------------------------------ */

  /** Diagnóstico de solo lectura: credencial de servicio, token de Kyros ID, emisor en FacturaSIN, enlace y sucursal/punto de venta. */
  async probar(t: Tenant, userId: string) {
    const c = await this.ajustes(t);
    if (!c) throw new ConflictException('Primero guarda la configuración de facturación.');
    const pasos: { paso: string; ok: boolean; detalle: string }[] = [];
    const paso = (p: string, ok: boolean, detalle: string) => { pasos.push({ paso: p, ok, detalle }); return ok; };
    let ambiente: string | null = null;
    try {
      const cli = await this.cliente(0);
      paso('Credencial de GESTRO ante FacturaSIN', true, 'Cargada (nunca se muestra).');
      const lista = (await cli.llamar('GET', '/v1/tenants')) as { id: string; nit: string; modoSiat?: string; nitDePrueba?: boolean }[];
      paso('Conexión con Kyros ID y FacturaSIN', true, `Autenticación correcta; GESTRO ve ${lista.length} emisor(es).`);
      const e = lista.find((x) => x.nit === c.nit);
      if (!e) paso('Emisor registrado', false, `El NIT ${c.nit} todavía no está en FacturaSIN. Usa «Conectar con FacturaSIN».`);
      else {
        ambiente = e.modoSiat ?? null;
        paso('Emisor registrado', true, `NIT ${c.nit} encontrado${e.modoSiat ? ` (modo ${e.modoSiat}${e.nitDePrueba ? ', NIT de prueba' : ''})` : ''}.`);
        const enlaces = (await cli.llamar('GET', `/v1/tenants/${e.id}/systems`)) as { sistema: string; idExterno: string }[];
        paso('Enlace de este restaurante', enlaces.some((x) => x.sistema === 'gestro' && x.idExterno === t.restaurantId), enlaces.some((x) => x.sistema === 'gestro' && x.idExterno === t.restaurantId) ? 'Enlazado.' : 'Este restaurante aún no está enlazado al emisor: usa «Conectar con FacturaSIN».');
        const suc = (await cli.llamar('GET', `/v1/tenants/${e.id}/branches`)) as { codigo: number }[];
        paso('Sucursal SIN', suc.some((s) => s.codigo === c.branch_code), suc.some((s) => s.codigo === c.branch_code) ? `La sucursal ${c.branch_code} existe.` : `La sucursal ${c.branch_code} no existe en FacturaSIN (hoy GESTRO solo puede usar la 0).`);
        const pv = (await cli.llamar('GET', `/v1/tenants/${e.id}/pos`)) as { sucursal: number; codigo: number }[];
        paso('Punto de venta SIN', pv.some((p) => p.sucursal === c.branch_code && p.codigo === c.pos_code), pv.some((p) => p.sucursal === c.branch_code && p.codigo === c.pos_code) ? `El punto de venta ${c.pos_code} existe.` : `El punto de venta ${c.pos_code} no existe en FacturaSIN.`);
      }
    } catch (e) { paso('Conexión', false, this.mensajeDe(e)); }
    const ok = pasos.length > 0 && pasos.every((p) => p.ok);
    const resumen = ok ? 'Conexión correcta.' : pasos.find((p) => !p.ok)?.detalle ?? 'No se pudo comprobar.';
    await this.db.run(t, async (tx) => { await tx.execute(sql`UPDATE billing_settings SET last_test_at = now(), last_test_ok = ${ok}, last_test_message = ${resumen.slice(0, 300)} WHERE restaurant_id = ${t.restaurantId}`); await auditar(tx, t.restaurantId, userId, 'facturacion.probada', 'billing_settings', t.restaurantId, { ok }); });
    return { ok, pasos, ambiente, aviso: AVISO_PRUEBAS };
  }

  /** Registra al emisor en FacturaSIN (o lo enlaza si ya existe para GESTRO), envía la credencial si está permitido y suscribe el webhook de retorno. */
  async conectar(t: Tenant, userId: string) {
    const c = await this.ajustes(t);
    if (!c) throw new ConflictException('Primero guarda la configuración de facturación.');
    const pasos: { paso: string; ok: boolean; detalle: string }[] = [];
    const cli = await this.cliente(1);
    try {
      const lista = (await cli.llamar('GET', '/v1/tenants')) as { id: string; nit: string }[];
      let emp = lista.find((x) => x.nit === c.nit);
      if (!emp) {
        emp = (await cli.llamar('POST', '/v1/tenants', { cuerpo: { nit: c.nit, razonSocial: c.legal_name, modalidad: 2, ambiente: 2, municipio: c.municipality, direccion: c.address, sectores: [1], idsExternos: [{ sistema: 'gestro', id: t.restaurantId }] } })) as { id: string; nit: string };
        pasos.push({ paso: 'Emisor creado en FacturaSIN', ok: true, detalle: `NIT ${c.nit} registrado en ambiente de pruebas.` });
      } else {
        await cli.llamar('POST', `/v1/tenants/${emp.id}/systems`, { cuerpo: { sistema: 'gestro', id: t.restaurantId } });
        pasos.push({ paso: 'Emisor enlazado', ok: true, detalle: `NIT ${c.nit} ya existía; este restaurante quedó enlazado.` });
      }
      const tok = await this.cfg.leer<{ valor: string | null }>(CLAVE_TOKEN(t.restaurantId));
      if (tok?.valor) {
        try { await cli.llamar('PUT', `/v1/tenants/${emp.id}/credentials`, { cuerpo: { tokenDelegado: tok.valor } }); pasos.push({ paso: 'Credencial del emisor', ok: true, detalle: 'Enviada a FacturaSIN (cifrada allá; no se puede leer).' }); }
        catch (e) { pasos.push({ paso: 'Credencial del emisor', ok: false, detalle: `FacturaSIN no la aceptó desde GESTRO (${this.mensajeDe(e)}). Cárgala en el panel de FacturaSIN.` }); }
      }
      const yaHook = await this.cfg.leer<{ secretos: string[] }>(CLAVE_WEBHOOK(t.restaurantId));
      if (!yaHook?.secretos?.length) {
        try {
          const url = `${destinosFacturasin().urlPublica.replace(/\/$/, '')}/api/v1/public/facturasin/webhook/${t.restaurantId}`;
          const w = await cli.crearWebhook(t.restaurantId, url, ['factura.pendiente', 'factura.validada', 'factura.observada', 'factura.rechazada', 'factura.anulada', 'factura.contingencia']);
          await this.cfg.guardar(CLAVE_WEBHOOK(t.restaurantId), { secretos: [w.secreto] }, userId);
          await this.db.run(t, (tx) => tx.execute(sql`UPDATE billing_settings SET webhook_set = true, webhook_updated_at = now() WHERE restaurant_id = ${t.restaurantId}`));
          pasos.push({ paso: 'Aviso de estados (webhook)', ok: true, detalle: 'Suscrito; el secreto se guardó cifrado.' });
        } catch (e) { pasos.push({ paso: 'Aviso de estados (webhook)', ok: false, detalle: `No se pudo suscribir (${this.mensajeDe(e)}). La conciliación periódica cubre los estados mientras tanto.` }); }
      } else pasos.push({ paso: 'Aviso de estados (webhook)', ok: true, detalle: 'Ya estaba suscrito.' });
      await this.db.run(t, async (tx) => { await tx.execute(sql`UPDATE billing_settings SET connected_at = now() WHERE restaurant_id = ${t.restaurantId}`); await auditar(tx, t.restaurantId, userId, 'facturacion.conectada', 'billing_settings', t.restaurantId, { pasos: pasos.map((p) => `${p.paso}:${p.ok}`) }); });
    } catch (e) { pasos.push({ paso: 'Conexión con FacturaSIN', ok: false, detalle: this.mensajeDe(e) }); }
    return { ok: pasos.every((p) => p.ok), pasos, aviso: AVISO_PRUEBAS };
  }

  private mensajeDe(e: unknown): string {
    if (e instanceof FacturaSinError) return `${e.codigo}: ${e.message.replace(/^[A-Z_]+: /, '')}`;
    if (e instanceof HttpException) { const r = e.getResponse() as { message?: string }; return typeof r === 'string' ? r : r.message ?? e.message; }
    const m = (e as Error)?.message ?? String(e);
    return /timeout|abort/i.test(m) ? 'FacturaSIN no respondió a tiempo.' : m.replace(/client_secret=[^&\s]*/gi, 'client_secret=***');
  }

  /* ------------------------------------------------------------------ emisión ------------------------------------------------------------------ */

  /** Valida y arma al comprador ANTES de cobrar (si falla, no se cobra con factura). */
  prepararComprador(d: FacturarDatos, permiteConsumidorFinal: boolean): { comprador: CompradorSalida; final: boolean } {
    try {
      if (d.consumidorFinal) {
        if (!permiteConsumidorFinal) throw new ErrorFactura('Este restaurante no factura a «sin nombre»: pide NIT o CI y razón social.');
        return { comprador: CONSUMIDOR_FINAL, final: true };
      }
      if (!d.comprador) throw new ErrorFactura('Para facturar indica el NIT, CI o pasaporte y la razón social del comensal (o elige «sin nombre»).');
      return { comprador: armarComprador(d.comprador), final: false };
    } catch (e) { if (e instanceof ErrorFactura) throw new UnprocessableEntityException(e.message); throw e; }
  }

  async exigirLista(tx: Bd, t: Tenant): Promise<{ permiteConsumidorFinal: boolean }> {
    const c = (await tx.execute(sql`SELECT enabled, allow_final_consumer FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as { enabled: boolean; allow_final_consumer: boolean } | undefined;
    if (!c) throw new UnprocessableEntityException('Configura la facturación (Configuración → Facturación electrónica) antes de facturar.');
    if (!c.enabled) throw new UnprocessableEntityException('La facturación electrónica está apagada en este restaurante.');
    return { permiteConsumidorFinal: c.allow_final_consumer };
  }

  /** Crea la factura del pedido cobrado y la intenta enviar. Si FacturaSIN no responde queda «pendiente de emitir» y se reintenta sola. */
  async facturar(t: Tenant, userId: string, orderId: string, cuerpo: unknown) {
    const d = Facturar.parse(cuerpo);
    const id = await this.crearFactura(t, userId, orderId, d);
    return this.enviar(t, id, 1);
  }

  async crearFactura(t: Tenant, userId: string, orderId: string, d: FacturarDatos): Promise<string> {
    return this.db.run(t, async (tx) => {
      const cfg = (await tx.execute(sql`SELECT branch_code, pos_code, economic_activities, default_sin_product_code, default_unit_code, enabled, allow_final_consumer, payment_codes FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as
        { branch_code: number; pos_code: number; economic_activities: string[]; default_sin_product_code: string; default_unit_code: number; enabled: boolean; allow_final_consumer: boolean; payment_codes: CodigosPago | null } | undefined;
      if (!cfg) throw new UnprocessableEntityException('Configura la facturación (Configuración → Facturación electrónica) antes de facturar.');
      if (!cfg.enabled) throw new UnprocessableEntityException('La facturación electrónica está apagada en este restaurante.');
      const o = (await tx.execute(sql`SELECT id, status, discount::text AS discount FROM orders WHERE id = ${orderId} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { id: string; status: string; discount: string } | undefined;
      if (!o) throw new NotFoundException('Pedido no encontrado.');
      if (o.status !== 'cobrado') throw new ConflictException('Solo se factura un pedido ya cobrado.');
      const pago = (await tx.execute(sql`SELECT id, method, amount::text AS amount, tip_amount::text AS tip FROM sales_payments WHERE order_id = ${orderId} AND restaurant_id = ${t.restaurantId} AND voided_at IS NULL ORDER BY paid_at DESC LIMIT 1`)).rows[0] as { id: string; method: string; amount: string; tip: string } | undefined;
      if (!pago) throw new ConflictException('El pedido no tiene un cobro vigente.');
      const viva = (await tx.execute(sql`SELECT id FROM fiscal_invoices WHERE order_id = ${orderId} AND status IN ('en_cola','pendiente','validada','observada','contingencia')`)).rows[0] as { id: string } | undefined;
      if (viva) throw new ConflictException('Este pedido ya tiene una factura. Para cambiarla, anúlala primero.');
      const { comprador, final } = this.prepararComprador(d, cfg.allow_final_consumer);
      let numeroTarjeta: string | undefined;
      if (pago.method === 'tarjeta') {
        if (!d.tarjeta) throw new UnprocessableEntityException('El cobro fue con tarjeta: indica los primeros 4 y los últimos 4 dígitos.');
        try { numeroTarjeta = tarjetaEnmascarada(d.tarjeta.primeros4, d.tarjeta.ultimos4); } catch (e) { throw new UnprocessableEntityException((e as Error).message); }
      }
      const lineas = (await tx.execute(sql`SELECT oi.id::text AS item_id, mi.name AS nombre, oi.qty::text AS cantidad, oi.unit_price::text AS precio, mi.sin_product_code AS codigo_sin, mi.sin_unit_code AS unidad
        FROM order_items oi JOIN menu_items mi ON mi.id = oi.menu_item_id WHERE oi.order_id = ${orderId} AND oi.voided_at IS NULL AND NOT (oi.from_qr AND oi.status = 'borrador') ORDER BY oi.course, oi.sent_at NULLS LAST, mi.name, oi.id`)).rows as
        { item_id: string; nombre: string; cantidad: string; precio: string; codigo_sin: string | null; unidad: number | null }[];
      const lp: LineaPedido[] = lineas.map((l) => ({ itemId: l.item_id, nombre: l.nombre, cantidad: l.cantidad, precio: l.precio, codigoSin: l.codigo_sin, unidad: l.unidad }));
      let calc;
      try { calc = calcularFactura({ lineas: lp, descuento: o.discount, propina: pago.tip }); } catch (e) { if (e instanceof ErrorFactura) throw new UnprocessableEntityException(e.message); throw e; }
      if (deCentavos(calc.total) !== Number(pago.amount).toFixed(2)) {
        await this.alertar(tx, t.restaurantId, `calculo:${orderId}`, 'alta', `La factura del pedido no cuadra con el cobro (factura Bs ${deCentavos(calc.total)}, cobro Bs ${pago.amount}). No se emitió.`, { orderId });
        throw new ConflictException('El total a facturar no coincide con lo cobrado: revisa el pedido antes de facturar.');
      }
      const intento = ((await tx.execute(sql`SELECT COALESCE(MAX(attempt), 0)::int AS n FROM fiscal_invoices WHERE order_id = ${orderId}`)).rows[0] as { n: number }).n + 1;
      const idExterno = idExternoDe(orderId, intento);
      let payload: PayloadFactura;
      try { payload = armarPayload({ idExterno, lineas: lp, descuento: o.discount, comprador, metodo: pago.method, numeroTarjeta, config: { sucursal: cfg.branch_code, puntoVenta: cfg.pos_code, actividad: cfg.economic_activities[0]!, codigoSinPorDefecto: cfg.default_sin_product_code, unidadPorDefecto: cfg.default_unit_code, codigosPago: cfg.payment_codes ?? undefined } }); }
      catch (e) { if (e instanceof ErrorFactura) throw new UnprocessableEntityException(e.message); throw e; }
      const f = (await tx.execute(sql`INSERT INTO fiscal_invoices (restaurant_id, order_id, payment_id, attempt, external_id, status, buyer_doc_type, buyer_doc_number, buyer_complement, buyer_name, buyer_email, buyer_exception, final_consumer,
          subtotal, discount, total, iva_ref, tip_excluded, payload, next_retry_at, created_by)
        VALUES (${t.restaurantId}, ${orderId}, ${pago.id}, ${intento}, ${idExterno}, 'en_cola', ${comprador.tipoDocumento}, ${comprador.numeroDocumento}, ${comprador.complemento ?? null}, ${comprador.razonSocial}, ${comprador.correo ?? null}, ${comprador.codigoExcepcion}, ${final},
          ${deCentavos(calc.subtotal)}::numeric, ${deCentavos(calc.descuento)}::numeric, ${deCentavos(calc.total)}::numeric, ${deCentavos(calc.iva)}::numeric, ${deCentavos(calc.propinaExcluida)}::numeric, ${JSON.stringify(payload)}::jsonb, now(), ${userId}::uuid) RETURNING id`)).rows[0] as { id: string };
      await auditar(tx, t.restaurantId, userId, 'factura.creada', 'fiscal_invoice', f.id, { pedido: orderId, intento, total: deCentavos(calc.total), iva: deCentavos(calc.iva), consumidorFinal: final });
      return f.id;
    });
  }

  private async cargar(tx: Bd, rid: string, id: string): Promise<Fila> {
    const f = (await tx.execute(sql`SELECT ${COLUMNAS} FROM fiscal_invoices WHERE id = ${id}::uuid AND restaurant_id = ${rid}`)).rows[0] as unknown as Fila | undefined;
    if (!f) throw new NotFoundException('Factura no encontrada.');
    return f;
  }

  /** Un intento de envío a FacturaSIN. Reclama la fila de forma atómica; nunca lanza por fallos de FacturaSIN (la venta no se bloquea). */
  async enviar(t: Tenant, id: string, reintentosRed: number) {
    const f = await this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`UPDATE fiscal_invoices SET tries = tries + 1, last_try_at = now(), next_retry_at = now() + interval '2 minutes' WHERE id = ${id}::uuid AND restaurant_id = ${t.restaurantId} AND status = 'en_cola' RETURNING ${COLUMNAS}`)).rows[0] as unknown as Fila | undefined;
      return r ?? (await this.cargar(tx, t.restaurantId, id));
    });
    if (f.status !== 'en_cola') return vistaFactura(f);
    try {
      const cli = await this.cliente(reintentosRed);
      const r = await cli.emitir(t.restaurantId, f.payload as never, f.external_id);
      await this.db.run(t, (tx) => this.aplicarRemoto(tx, f, r));
    } catch (e) { await this.registrarFallo(t, f, e); }
    return this.vista(t, id);
  }

  async vista(t: Tenant, id: string) { return this.db.run(t, async (tx) => vistaFactura(await this.cargar(tx, t.restaurantId, id))); }

  /** Aplica la respuesta de FacturaSIN a la fila local y contrasta los totales con el cálculo propio. */
  private async aplicarRemoto(tx: Bd, f: Fila, r: Factura) {
    const estado = estadoLocal(r.estado);
    const totalFs = Number((r.totales as { montoTotal?: number }).montoTotal ?? NaN);
    const ivaFs = Number((r.totales as { ivaReferencial?: number }).ivaReferencial ?? NaN);
    const cuadra = totalFs.toFixed(2) === Number(f.total).toFixed(2) && ivaFs.toFixed(2) === Number(f.iva_ref).toFixed(2);
    const nota = cuadra ? null : `Los totales de FacturaSIN (total ${totalFs}, IVA ${ivaFs}) no coinciden con el cálculo de GESTRO (total ${f.total}, IVA ${f.iva_ref}).`;
    if (nota) await this.alertar(tx, f.restaurant_id, `totales:${f.id}`, 'alta', nota, { facturaId: f.id });
    await tx.execute(sql`UPDATE fiscal_invoices SET status = ${estado}, fs_invoice_id = ${r.id}, invoice_number = ${r.numero ?? null}, cuf = ${r.cuf ?? null}, issued_at = ${r.fechaEmision ?? null}::timestamptz,
      fs_total = ${Number.isFinite(totalFs) ? totalFs.toFixed(2) : null}::numeric, fs_iva = ${Number.isFinite(ivaFs) ? ivaFs.toFixed(2) : null}::numeric, links = ${JSON.stringify(r.enlaces ?? null)}::jsonb, qr_text = ${r.qrTexto ?? null},
      notice = ${r.avisoFiscal ?? null}, test_env = ${r.ambientePruebas !== false}, errors = ${r.errores ? JSON.stringify(r.errores) : null}::jsonb, last_error = ${nota}, next_retry_at = NULL, updated_at = now() WHERE id = ${f.id}::uuid`);
    await this.resolverAlerta(tx, f.restaurant_id, `pendiente:${f.id}`);
    await auditar(tx, f.restaurant_id, null, 'factura.respuesta', 'fiscal_invoice', f.id, { estado, numero: r.numero, cuf: r.cuf });
  }

  private async registrarFallo(t: Tenant, f: Fila, e: unknown) {
    const msg = this.mensajeDe(e).slice(0, 500);
    await this.db.run(t, async (tx) => {
      if (e instanceof FacturaSinError && e.estado === 422) {
        const rechazo = e.codigo === 'SIAT_RECHAZO';
        await tx.execute(sql`UPDATE fiscal_invoices SET status = ${rechazo ? 'rechazada' : 'error_datos'}, last_error = ${msg}, errors = ${JSON.stringify(e.detalle ?? null)}::jsonb, next_retry_at = NULL, updated_at = now() WHERE id = ${f.id}::uuid`);
        await this.resolverAlerta(tx, f.restaurant_id, `pendiente:${f.id}`);
        await auditar(tx, f.restaurant_id, null, rechazo ? 'factura.rechazada' : 'factura.datos_invalidos', 'fiscal_invoice', f.id, { mensaje: msg });
        return;
      }
      if (e instanceof FacturaSinError && e.estado === 409 && e.codigo === 'IDEMPOTENCIA_CONFLICTO') {
        await tx.execute(sql`UPDATE fiscal_invoices SET status = 'error_datos', last_error = ${msg}, next_retry_at = NULL, updated_at = now() WHERE id = ${f.id}::uuid`);
        return;
      }
      // Red caída, SIN/FacturaSIN no disponible, 429/5xx o configuración pendiente: queda «pendiente de emitir» y se reintenta con espera creciente.
      const espera = esperaDeReintento(f.tries);
      const config = (e instanceof FacturaSinError && ERRORES_DE_CONFIGURACION.has(e.codigo)) || (e instanceof HttpException && (e.getResponse() as { code?: string })?.code === 'SIN_CREDENCIAL_DE_SERVICIO');
      await tx.execute(sql`UPDATE fiscal_invoices SET last_error = ${msg}, next_retry_at = now() + (${Math.round(espera / 1000)}::int * interval '1 second'), updated_at = now() WHERE id = ${f.id}::uuid`);
      if (config || f.tries >= 3) await this.alertar(tx, f.restaurant_id, `pendiente:${f.id}`, 'alta', config ? `Factura pendiente de emitir: ${msg}` : 'Hay una factura pendiente de emitir: FacturaSIN no responde. La venta quedó cobrada y se reintenta sola.', { facturaId: f.id });
    });
  }

  /* ------------------------------------------------------------------ cola, conciliación y consulta ------------------------------------------------------------------ */

  private async alertar(tx: Bd, rid: string, clave: string, severidad: 'info' | 'media' | 'alta', mensaje: string, datos: Record<string, unknown>) {
    const ya = (await tx.execute(sql`SELECT id FROM alerts WHERE restaurant_id = ${rid} AND kind = 'facturacion' AND resolved_at IS NULL AND data->>'clave' = ${clave}`)).rows[0] as { id: string } | undefined;
    if (ya) await tx.execute(sql`UPDATE alerts SET message = ${mensaje}, severity = ${severidad} WHERE id = ${ya.id}::uuid`);
    else await tx.execute(sql`INSERT INTO alerts (restaurant_id, kind, severity, message, data) VALUES (${rid}, 'facturacion', ${severidad}, ${mensaje}, ${JSON.stringify({ ...datos, clave })}::jsonb)`);
  }
  private resolverAlerta(tx: Bd, rid: string, clave: string) {
    return tx.execute(sql`UPDATE alerts SET resolved_at = now() WHERE restaurant_id = ${rid} AND kind = 'facturacion' AND resolved_at IS NULL AND data->>'clave' = ${clave}`);
  }

  /** Reintenta las facturas «en cola» vencidas y concilia las «pendiente»/«contingencia» con FacturaSIN. Seguro de llamar cuando sea. */
  async procesarPendientes(limite = 25) {
    const plat: Tenant = { restaurantId: '', restaurantIds: [], plataforma: true };
    const cola = await this.db.run(plat, async (tx) => (await tx.execute(sql`SELECT id::text, restaurant_id::text FROM fiscal_invoices WHERE status = 'en_cola' AND next_retry_at <= now() ORDER BY next_retry_at LIMIT ${limite}`)).rows as { id: string; restaurant_id: string }[]);
    let enviadas = 0;
    for (const x of cola) { await this.enviar({ restaurantId: x.restaurant_id, restaurantIds: [] }, x.id, 2); enviadas++; }
    const aConciliar = await this.db.run(plat, async (tx) => (await tx.execute(sql`SELECT id::text, restaurant_id::text FROM fiscal_invoices WHERE status IN ('pendiente','contingencia') AND updated_at < now() - interval '1 minute' ORDER BY updated_at LIMIT ${limite}`)).rows as { id: string; restaurant_id: string }[]);
    let conciliadas = 0;
    for (const x of aConciliar) { if (await this.conciliarUna({ restaurantId: x.restaurant_id, restaurantIds: [] }, x.id)) conciliadas++; }
    return { enviadas, conciliadas };
  }

  /** Consulta a FacturaSIN el estado de una factura enviada y lo aplica. Devuelve true si cambió. */
  async conciliarUna(t: Tenant, id: string): Promise<boolean> {
    const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, id));
    try {
      const cli = await this.cliente(1);
      const r = await cli.porIdExterno(f.external_id, t.restaurantId);
      const nuevo = estadoLocal(r.estado);
      if (nuevo === f.status && f.fs_invoice_id) { await this.db.run(t, (tx) => tx.execute(sql`UPDATE fiscal_invoices SET updated_at = now() WHERE id = ${id}::uuid`)); return false; }
      await this.db.run(t, (tx) => this.aplicarRemoto(tx, f, r));
      return true;
    } catch (e) { this.log.warn(`No se pudo conciliar la factura ${id}: ${this.mensajeDe(e)}`); return false; }
  }

  async conciliar(t: Tenant, userId: string) {
    const ids = await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT id::text FROM fiscal_invoices WHERE restaurant_id = ${t.restaurantId} AND status IN ('en_cola','pendiente','contingencia')`)).rows as { id: string }[]);
    let cambiadas = 0;
    for (const x of ids) {
      const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, x.id));
      if (f.status === 'en_cola') { await this.db.run(t, (tx) => tx.execute(sql`UPDATE fiscal_invoices SET next_retry_at = now() WHERE id = ${x.id}::uuid`)); const v = await this.enviar(t, x.id, 1); if (v.estado !== 'en_cola') cambiadas++; }
      else if (await this.conciliarUna(t, x.id)) cambiadas++;
    }
    await this.db.run(t, (tx) => auditar(tx, t.restaurantId, userId, 'factura.conciliacion', 'billing_settings', t.restaurantId, { revisadas: ids.length, cambiadas }));
    return { revisadas: ids.length, cambiadas };
  }

  async reintentar(t: Tenant, userId: string, id: string) {
    const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, id));
    if (f.status !== 'en_cola') throw new ConflictException('Solo se reintenta una factura pendiente de emitir. Si fue rechazada, corrige los datos y vuelve a facturar.');
    await this.db.run(t, async (tx) => { await tx.execute(sql`UPDATE fiscal_invoices SET next_retry_at = now() WHERE id = ${id}::uuid`); await auditar(tx, t.restaurantId, userId, 'factura.reintento_manual', 'fiscal_invoice', id); });
    return this.enviar(t, id, 1);
  }

  /* ------------------------------------------------------------------ consulta, PDF, anulación ------------------------------------------------------------------ */

  async delPedido(t: Tenant, orderId: string) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT ${COLUMNAS} FROM fiscal_invoices WHERE order_id = ${orderId}::uuid AND restaurant_id = ${t.restaurantId} ORDER BY attempt DESC`)).rows as unknown as Fila[];
      const viva = r.find((x) => (VIVAS as readonly string[]).includes(x.status)) ?? r[0] ?? null;
      const pago = (await tx.execute(sql`SELECT method FROM sales_payments WHERE order_id = ${orderId}::uuid AND restaurant_id = ${t.restaurantId} AND voided_at IS NULL ORDER BY paid_at DESC LIMIT 1`)).rows[0] as { method: string } | undefined;
      return { factura: viva ? vistaFactura(viva) : null, historial: r.filter((x) => x !== viva).map(vistaFactura), cobro: pago ? { metodo: pago.method } : null };
    });
  }

  async lista(t: Tenant, estado?: string) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT ${COLUMNAS}, (SELECT COALESCE(o.ticket_number::text, '') FROM orders o WHERE o.id = fiscal_invoices.order_id) AS ticket FROM fiscal_invoices WHERE restaurant_id = ${t.restaurantId} ${estado ? sql`AND status = ${estado}` : sql``} ORDER BY created_at DESC LIMIT 200`)).rows as unknown as (Fila & { ticket: string })[];
      return r.map((x) => ({ ...vistaFactura(x), ticket: x.ticket || null }));
    });
  }

  async archivo(t: Tenant, id: string, tipo: 'pdf' | 'xml', formato: 'a4' | 'rollo') {
    const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, id));
    if (!f.fs_invoice_id) throw new ConflictException('Esta factura todavía no fue emitida: no hay documento para imprimir.');
    try {
      const cli = await this.cliente(1);
      return tipo === 'pdf' ? await cli.pdf(t.restaurantId, f.fs_invoice_id, formato) : await cli.xml(t.restaurantId, f.fs_invoice_id);
    } catch (e) { throw new ServiceUnavailableException(`No se pudo obtener el documento de FacturaSIN: ${this.mensajeDe(e)}`); }
  }

  async anular(t: Tenant, userId: string, id: string, cuerpo: unknown) {
    const d = AnularFactura.parse(cuerpo);
    const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, id));
    if (f.status === 'anulada') throw new ConflictException('La factura ya está anulada.');
    if (['rechazada', 'error_datos'].includes(f.status)) throw new ConflictException('Esta factura no llegó a emitirse: no hay nada que anular. Vuelve a facturar con los datos corregidos.');
    const cli = await this.cliente(1).catch((e) => { throw e; });
    if (f.status === 'en_cola' && !f.fs_invoice_id) {
      // Puede que FacturaSIN la haya recibido y la respuesta se perdió: se consulta antes de cancelar localmente.
      let remota: Factura | null = null;
      try { remota = await cli.porIdExterno(f.external_id, t.restaurantId); }
      catch (e) { if (!(e instanceof FacturaSinError && e.estado === 404)) throw new ServiceUnavailableException(`No se pudo comprobar con FacturaSIN: ${this.mensajeDe(e)}. Intenta de nuevo en unos minutos.`); }
      if (remota) { await this.db.run(t, (tx) => this.aplicarRemoto(tx, f, remota!)); throw new ConflictException('La factura sí había llegado a FacturaSIN: ya se actualizó su estado. Vuelve a pedir la anulación.'); }
      await this.db.run(t, async (tx) => {
        await tx.execute(sql`UPDATE fiscal_invoices SET status = 'anulada', void_code = ${d.motivo}, void_reason = ${d.comentario}, voided_by = ${userId}::uuid, voided_at = now(), next_retry_at = NULL, updated_at = now() WHERE id = ${id}::uuid`);
        await this.resolverAlerta(tx, t.restaurantId, `pendiente:${id}`);
        await auditar(tx, t.restaurantId, userId, 'factura.cancelada_sin_emitir', 'fiscal_invoice', id, { motivo: d.comentario });
      });
      return this.vista(t, id);
    }
    if (!f.fs_invoice_id) throw new ConflictException('La factura aún no tiene número: espera a que FacturaSIN la confirme.');
    if (['pendiente', 'contingencia'].includes(f.status)) throw new ConflictException('El SIN todavía no validó esta factura: se podrá anular cuando quede validada.');
    try { await cli.anular(t.restaurantId, f.fs_invoice_id, d.motivo, d.comentario); }
    catch (e) {
      if (e instanceof FacturaSinError && e.estado < 500) throw new UnprocessableEntityException(this.mensajeDe(e));
      throw new ServiceUnavailableException(`FacturaSIN no respondió: ${this.mensajeDe(e)}. La factura sigue vigente; intenta de nuevo.`);
    }
    await this.db.run(t, async (tx) => {
      await tx.execute(sql`UPDATE fiscal_invoices SET status = 'anulada', void_code = ${d.motivo}, void_reason = ${d.comentario}, voided_by = ${userId}::uuid, voided_at = now(), updated_at = now() WHERE id = ${id}::uuid`);
      await auditar(tx, t.restaurantId, userId, 'factura.anulada', 'fiscal_invoice', id, { motivo: d.motivo, comentario: d.comentario, numero: f.invoice_number });
    });
    return this.vista(t, id);
  }

  /* ------------------------------------------------------------------ webhook de retorno ------------------------------------------------------------------ */

  /** Recibe un evento firmado de FacturaSIN. Verifica HMAC sobre el cuerpo CRUDO, tolera 5 min, deduplica por id de evento y no retrocede por eventos viejos. */
  async recibirWebhook(rid: string, cabeceraFirma: string | undefined, eventoId: string | undefined, crudo: string | undefined) {
    const guardado = /^[0-9a-f-]{36}$/i.test(rid) ? await this.cfg.leer<{ secretos: string[] }>(CLAVE_WEBHOOK(rid)) : null;
    if (!guardado?.secretos?.length || !crudo || !cabeceraFirma || !verificarFirmaWebhook(guardado.secretos, cabeceraFirma, crudo)) throw new UnauthorizedException('Firma no válida.');
    let ev: { id?: string; tipo?: string; creadoEn?: string; datos?: { idExterno?: string; cuf?: string; numero?: number; estado?: string; ambientePruebas?: boolean } };
    try { ev = JSON.parse(crudo); } catch { throw new BadRequestException('Cuerpo inválido.'); }
    const idEv = (eventoId ?? ev.id ?? '').slice(0, 120);
    if (!idEv || !ev.tipo || !ev.datos?.idExterno) throw new BadRequestException('Evento incompleto.');
    const t: Tenant = { restaurantId: rid, restaurantIds: [] };
    const mapa: Record<string, string> = { 'factura.pendiente': 'pendiente', 'factura.validada': 'validada', 'factura.observada': 'observada', 'factura.rechazada': 'rechazada', 'factura.anulada': 'anulada', 'factura.contingencia': 'contingencia' };
    return this.db.run(t, async (tx) => {
      const nuevo = (await tx.execute(sql`INSERT INTO fiscal_webhook_events (event_id, restaurant_id, kind) VALUES (${idEv}, ${rid}, ${ev.tipo!}) ON CONFLICT DO NOTHING RETURNING event_id`)).rows.length > 0;
      if (!nuevo) return { ok: true, duplicado: true };
      const estado = mapa[ev.tipo!];
      if (!estado) return { ok: true, ignorado: 'evento sin efecto en facturas' };
      const f = (await tx.execute(sql`SELECT ${COLUMNAS} FROM fiscal_invoices WHERE restaurant_id = ${rid} AND external_id = ${ev.datos!.idExterno!}`)).rows[0] as unknown as Fila | undefined;
      if (!f) return { ok: true, ignorado: 'factura desconocida' };
      const cuando = ev.creadoEn && !Number.isNaN(Date.parse(ev.creadoEn)) ? new Date(ev.creadoEn) : new Date();
      if (f.last_event_at && cuando.getTime() < new Date(f.last_event_at).getTime()) return { ok: true, ignorado: 'evento anterior al último aplicado' };
      await tx.execute(sql`UPDATE fiscal_invoices SET status = ${estado}, cuf = COALESCE(cuf, ${ev.datos!.cuf ?? null}), invoice_number = COALESCE(invoice_number, ${ev.datos!.numero ?? null}::bigint), last_event_at = ${cuando.toISOString()}::timestamptz,
        next_retry_at = CASE WHEN ${estado} = 'pendiente' THEN next_retry_at ELSE NULL END,
        last_error = CASE WHEN ${estado} IN ('validada','observada','anulada') THEN NULL ELSE last_error END, updated_at = now() WHERE id = ${f.id}::uuid`);
      if (estado !== 'pendiente') await this.resolverAlerta(tx, rid, `pendiente:${f.id}`);
      await auditar(tx, rid, null, 'factura.webhook', 'fiscal_invoice', f.id, { evento: ev.tipo, estado });
      return { ok: true, estado };
    });
  }
}

export { TIPOS_DOCUMENTO };
