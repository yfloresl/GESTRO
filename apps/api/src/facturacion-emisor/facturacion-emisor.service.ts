import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { FacturaSinConexion } from '../facturacion-kyros/facturasin-conexion';
import { facturacionHabilitada, mensajeIntegracion, type HabilitacionFacturacion } from '../facturacion-kyros/nucleo/integracion';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { Bd, BD, Tenant, TenantDb } from '../database/database.module';
import {
  armarComprador, armarPayload, calcularFactura, CompradorSalida, CONSUMIDOR_FINAL, deCentavos, ErrorFactura, esperaDeReintento, estadoLocal, idExternoDe,
  CODIGOS_PAGO_POR_DEFECTO, CodigosPago, LineaPedido, limpiarTexto, PayloadFactura, tarjetaEnmascarada, TIPOS_DOCUMENTO, validarNit,
} from './calculo-factura';
import { evaluarRegimenFiscal, TEXTO_AVISO_CODIGOS } from '../facturacion-kyros/nucleo/normativa';
import { Factura, FacturaSinError } from '../facturacion-kyros/nucleo';

/* ------------------------------------------------------------------ esquemas ------------------------------------------------------------------ */

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Fecha inválida');
/** Paso 2 «Datos del SIN»: lo ESTRICTAMENTE necesario. Sucursal, punto de venta, actividad, producto y unidad los pone FacturaSIN por convencion/rubro. */
export const ConfigFacturacion = z.object({
  nit: z.string().trim(),
  razonSocial: z.string(),
  municipio: z.string(), direccion: z.string(), leyenda: z.string().max(300).nullable().optional(),
  permiteConsumidorFinal: z.boolean().default(true), habilitada: z.boolean().default(true),
  /** F10: régimen declarado (solo avisa; el Simplificado no puede emitir factura con crédito fiscal). */
  regimen: z.enum(['general', 'simplificado', 'no_declarado']).default('no_declarado'),
  /** Avanzado: códigos del catálogo `metodoPago` de FacturaSIN por método de cobro (configuración, no constantes). */
  codigosPago: z.object({ efectivo: z.number().int().min(1).max(999), tarjeta: z.number().int().min(1).max(999), otro: z.number().int().min(1).max(999) }).default({ efectivo: 1, tarjeta: 2, otro: 7 }),
  codigosConfirmados: z.boolean().default(false),
  /** Lo que entrega el SIN al restaurante: se ENVÍA a FacturaSIN (cifrado allá) y no se guarda en GESTRO. */
  codigoSistema: z.string().trim().min(3, 'El código de sistema del SIN parece incompleto (mínimo 3 caracteres).').max(100).optional(),
  tokenDelegado: z.string().min(10, 'El token delegado parece incompleto.').max(4000).optional(),
  tokenVenceEn: Fecha.nullable().optional(),
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

interface Fila {
  id: string; restaurant_id: string; order_id: string; payment_id: string; attempt: number; external_id: string; status: string;
  buyer_doc_type: number; buyer_doc_number: string; buyer_complement: string | null; buyer_name: string; buyer_email: string | null; final_consumer: boolean;
  subtotal: string; discount: string; total: string; iva_ref: string; tip_excluded: string; payload: PayloadFactura;
  fs_invoice_id: string | null; invoice_number: string | null; cuf: string | null; issued_at: Date | string | null; fs_total: string | null; fs_iva: string | null;
  qr_text: string | null; notice: string | null; test_env: boolean; errors: unknown; last_error: string | null; tries: number; next_retry_at: Date | string | null; last_event_at: Date | string | null;
  links?: unknown;
  snapshot: { desglose?: { neto?: number; iva?: number; total?: number; modoIva?: string }; fechaEmision?: string } | null;
  void_code: number | null; void_reason: string | null; voided_at: Date | string | null; created_at: Date | string;
}
const COLUMNAS = sql.raw(`id, restaurant_id, order_id, payment_id, attempt, external_id, status, buyer_doc_type, buyer_doc_number, buyer_complement, buyer_name, buyer_email, final_consumer,
  subtotal::text, discount::text, total::text, iva_ref::text, tip_excluded::text, payload, fs_invoice_id, invoice_number::text, cuf, issued_at, fs_total::text, fs_iva::text,
  qr_text, notice, test_env, links, errors, last_error, tries, next_retry_at, last_event_at, void_code, void_reason, voided_at, created_at, snapshot`);

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
    registrada: f.snapshot ? { desglose: f.snapshot.desglose ?? null, fecha: f.snapshot.fechaEmision ?? null, enlaces: f.links ?? null, ambientePruebas: f.test_env } : null,
    anulacion: f.status === 'anulada' ? { motivo: f.void_reason, codigo: f.void_code, cuando: iso(f.voided_at) } : null, creada: iso(f.created_at)!,
  };
}

/** Errores de FacturaSIN que no se arreglan reintentando: hay que corregir la configuración (credenciales, empresa, permisos). */
const ERRORES_DE_CONFIGURACION = new Set(['NO_AUTENTICADO', 'SIN_PERMISO', 'EMPRESA_NO_ENCONTRADA', 'EMPRESA_BLOQUEADA', 'CREDENCIAL_FALTANTE', 'TOKEN_VENCIDO', 'USUARIO_NO_VINCULADO']);

@Injectable()
export class FacturacionEmisorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Facturacion');
  private reloj?: NodeJS.Timeout;

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb, @Inject(BD) private readonly bd: Bd,
    @Inject(ConfiguracionService) private readonly cfg: ConfiguracionService, @Inject(FacturaSinConexion) private readonly conexion: FacturaSinConexion,
  ) {}

  /** Cola de reintentos y conciliación de pendientes: cada minuto. La venta nunca depende de este proceso. */
  onModuleInit() {
    if (process.env.VITEST !== undefined) return;
    this.reloj = setInterval(() => { void this.procesarPendientes().catch((e) => this.log.error(`Cola de facturas: ${(e as Error).message}`)); }, 60_000);
    this.reloj.unref();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /* ------------------------------------------------------------- cliente FacturaSIN ------------------------------------------------------------- */

  private async cliente(reintentos: number) {
    const c = await this.conexion.cliente(reintentos);
    if (!c) throw new ServiceUnavailableException({ code: 'SIN_CREDENCIAL_DE_SERVICIO', message: 'Falta enlazar GESTRO con FacturaSIN (arranque inicial de la plataforma, una sola vez). Tus facturas quedan en cola y salen solas al conectar.' });
    return c;
  }

  /* ------------------------------------------------------------------ configuración ------------------------------------------------------------------ */

  private vistaConfig(c: Record<string, unknown>) {
    return {
      configurada: true, nit: c.nit, razonSocial: c.legal_name, municipio: c.municipality, direccion: c.address, leyenda: c.legend ?? null,
      permiteConsumidorFinal: c.allow_final_consumer, habilitada: c.enabled,
      credencialSinEnviada: c.token_set, tokenVenceEn: c.token_expires_on ?? null, sincronizadaEn: c.connected_at ?? null,
      ultimaPrueba: c.last_test_at ? { cuando: c.last_test_at, ok: c.last_test_ok, mensaje: c.last_test_message } : null,
      ambientePruebas: true, aviso: AVISO_PRUEBAS,
      regimen: c.tax_regime ?? 'no_declarado', avisosRegimen: evaluarRegimenFiscal({ regimen: c.tax_regime as string, nit: c.nit as string }).avisos,
      codigosPago: c.payment_codes ?? CODIGOS_PAGO_POR_DEFECTO, codigosConfirmados: c.codes_confirmed === true, avisoCodigos: c.codes_confirmed === true ? null : TEXTO_AVISO_CODIGOS,
    };
  }

  /** Override del SuperAdmin (si existe) de la facturacion de un restaurante. Vive cifrado en `app_config` (sin tabla con RLS nueva). */
  private async overrideDe(rid: string): Promise<boolean | null> {
    const o = await this.cfg.leer<{ valor: boolean | null }>(`facturacion.habilitada.${rid}`);
    return typeof o?.valor === 'boolean' ? o.valor : null;
  }

  /** Datos del cliente para el estandar «pago + interruptor»: override del SuperAdmin y si tiene un plan de PAGO vigente (sucursal activa, vigente y con un pago de suscripcion validado; la prueba y la demostracion no lo son). */
  async clienteFacturable(rid: string): Promise<{ override: boolean | null; planDePagoVigente: boolean }> {
    const p = (await this.bd.execute(sql`SELECT (r.status = 'activo' AND r.paid_until IS NOT NULL AND r.paid_until >= CURRENT_DATE AND EXISTS (SELECT 1 FROM subscription_payments sp WHERE sp.restaurant_id = r.id AND sp.status = 'validado')) AS pago FROM restaurants r WHERE r.id = ${rid}::uuid`)).rows[0] as { pago: boolean } | undefined;
    return { override: await this.overrideDe(rid), planDePagoVigente: p?.pago === true };
  }

  /** Estado efectivo (helper unico `facturacionHabilitada`): override del SuperAdmin, luego plan de pago, luego «No incluida». Se declara a FacturaSIN (`PUT /integraciones/habilitacion/{id}`). */
  async habilitacionDe(rid: string): Promise<HabilitacionFacturacion> {
    const h = facturacionHabilitada(await this.clienteFacturable(rid));
    try { if ((await this.conexion.conectada()) || (await this.conexion.puedeEnlazar())) await (await this.conexion.enlace()).declararHabilitacion(rid, h.habilitada, h.etiqueta); } catch { /* FacturaSIN no responde: manda el criterio local; se reintenta en el proximo uso */ }
    return h;
  }

  /** Paso 1 («Facturación» solo si está habilitada): si no, «No incluida en tu plan» + cómo pedirla. */
  async habilitacion(t: Tenant): Promise<{ habilitada: boolean; mensaje: string | null; motivo?: string }> {
    const h = await this.habilitacionDe(t.restaurantId);
    if (!h.habilitada) return { habilitada: false, mensaje: h.mensaje, motivo: h.motivo };
    try {
      if ((await this.conexion.conectada()) || (await this.conexion.puedeEnlazar())) {
        const r = await (await this.conexion.enlace()).habilitacion(t.restaurantId);
        if (!r.habilitada) return { habilitada: false, mensaje: r.mensaje || 'La facturación electrónica no está habilitada para tu cuenta.', motivo: 'no_incluida' };
      }
    } catch { /* FacturaSIN no responde: manda el criterio local */ }
    return { habilitada: true, mensaje: null, motivo: h.motivo };
  }

  /** SuperAdmin: clientes (restaurantes) con su estado efectivo de facturacion y su motivo, para el interruptor por cliente. */
  async clientesFacturacion(q?: string) {
    const filtro = q && q.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const filas = (await this.bd.execute(sql`SELECT r.id::text AS id, (a.legal_name || ' · ' || r.name) AS nombre FROM restaurants r JOIN accounts a ON a.id = r.account_id
      WHERE ${filtro}::text IS NULL OR (a.legal_name || ' ' || r.name) ILIKE ${filtro} ORDER BY nombre LIMIT 100`)).rows as { id: string; nombre: string }[];
    const out = [];
    for (const x of filas) {
      const c = await this.clienteFacturable(x.id);
      const h = facturacionHabilitada(c);
      out.push({ id: x.id, nombre: x.nombre, override: c.override, habilitada: h.habilitada, motivo: h.motivo, etiqueta: h.etiqueta });
    }
    return { clientes: out };
  }

  /** SuperAdmin: interruptor «Facturación» de un cliente: `true` encendido, `false` apagado, `null` vuelve al criterio por plan. Se declara a FacturaSIN al instante. */
  async fijarFacturacionCliente(actor: string, rid: string, habilitada: boolean | null) {
    const e = (await this.bd.execute(sql`SELECT 1 FROM restaurants WHERE id = ${rid}::uuid`)).rows[0];
    if (!e) throw new NotFoundException('Cliente no encontrado.');
    await this.cfg.guardar(`facturacion.habilitada.${rid}`, { valor: habilitada }, actor);
    const h = await this.habilitacionDe(rid);
    await this.bd.execute(sql`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after) VALUES (${rid}::uuid, ${actor}::uuid, 'facturacion.habilitacion_fijada', 'facturacion_cliente', ${rid}, ${JSON.stringify({ override: habilitada, motivo: h.motivo })}::jsonb)`).catch(() => undefined);
    return { id: rid, override: habilitada, habilitada: h.habilitada, motivo: h.motivo, etiqueta: h.etiqueta };
  }

  async config(t: Tenant) {
    const hab = await this.habilitacion(t);
    const c = await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT nit, legal_name, municipality, address, legend, allow_final_consumer, enabled, tax_regime,
        token_set, token_expires_on::text AS token_expires_on, connected_at, last_test_at, last_test_ok, last_test_message, payment_codes, codes_confirmed FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as Record<string, unknown> | undefined);
    if (c) return { ...this.vistaConfig(c), habilitacion: hab };
    const [a] = await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT a.legal_name, a.nit FROM restaurants r JOIN accounts a ON a.id = r.account_id WHERE r.id = ${t.restaurantId}`)).rows as { legal_name: string; nit: string | null }[]);
    return { configurada: false, sugerencia: { nit: a?.nit ?? '', razonSocial: a?.legal_name ?? '' }, ambientePruebas: true, aviso: AVISO_PRUEBAS, permiteConsumidorFinal: true, habilitada: true, regimen: 'no_declarado', avisosRegimen: [], codigosPago: CODIGOS_PAGO_POR_DEFECTO, codigosConfirmados: false, avisoCodigos: TEXTO_AVISO_CODIGOS, habilitacion: hab };
  }

  /** Lo mínimo que necesita Caja para decidir si ofrece «Facturar» (lo lee cualquier rol de cobro). */
  async estado(t: Tenant) {
    const hab = await this.habilitacion(t);
    return this.db.run(t, async (tx) => {
      const c = (await tx.execute(sql`SELECT enabled, allow_final_consumer FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as { enabled: boolean; allow_final_consumer: boolean } | undefined;
      const p = (await tx.execute(sql`SELECT count(*)::int AS n FROM fiscal_invoices WHERE restaurant_id = ${t.restaurantId} AND status = 'en_cola'`)).rows[0] as { n: number };
      return { disponible: !!c?.enabled && hab.habilitada, habilitacion: hab, ambientePruebas: true, aviso: AVISO_PRUEBAS, permiteConsumidorFinal: c?.allow_final_consumer ?? false, pendientesDeEmitir: p.n };
    });
  }

  /**
   * Paso 2 «Datos del SIN»: guarda lo estrictamente necesario y crea/actualiza la empresa del restaurante en FacturaSIN (`PUT /integraciones/empresas/{id}`), con las
   * credenciales del SIN que se ENVÍAN y se descartan. Si FacturaSIN no responde, los datos quedan guardados y se reintenta en «Probar facturación».
   */
  async guardarConfig(t: Tenant, userId: string, cuerpo: unknown) {
    const d = ConfigFacturacion.parse(cuerpo);
    const hab = await this.habilitacion(t);
    if (!hab.habilitada) throw new ForbiddenException(hab.mensaje ?? 'La facturación electrónica no está incluida en tu plan.');
    let v;
    try {
      v = {
        nit: validarNit(d.nit), razonSocial: limpiarTexto(d.razonSocial, 'Razón social', 2, 200), municipio: limpiarTexto(d.municipio, 'Municipio', 2, 100), direccion: limpiarTexto(d.direccion, 'Dirección', 3, 300),
        leyenda: d.leyenda?.trim() ? limpiarTexto(d.leyenda, 'Leyenda', 3, 300) : null,
      };
    } catch (e) { if (e instanceof ErrorFactura) throw new UnprocessableEntityException(e.message); throw e; }
    // Un mismo NIT no puede ser reclamado por dos cuentas distintas de GESTRO (evita facturar a nombre de otro).
    const otra = (await this.bd.execute(sql`SELECT 1 FROM billing_settings b JOIN restaurants r ON r.id = b.restaurant_id JOIN restaurants mi ON mi.id = ${t.restaurantId}
      WHERE b.nit = ${v.nit} AND b.restaurant_id <> ${t.restaurantId} AND r.account_id <> mi.account_id`)).rows;
    if (otra.length) throw new ConflictException('Ese NIT ya está registrado por otra cuenta de GESTRO. Si es tuyo, escribe a administracion@kyros-tech.com.');
    const enviaCred = !!(d.codigoSistema && d.tokenDelegado);
    if ((d.codigoSistema || d.tokenDelegado) && !enviaCred) throw new UnprocessableEntityException('Para cargar las credenciales del SIN indica el código de sistema y el token delegado juntos.');
    await this.db.run(t, async (tx) => {
      await tx.execute(sql`INSERT INTO billing_settings (restaurant_id, nit, legal_name, economic_activities, municipality, address, legend, mode, default_sin_product_code, allow_final_consumer, enabled, tax_regime, payment_codes, codes_confirmed, token_set, token_expires_on, updated_by, connected_at)
        VALUES (${t.restaurantId}, ${v.nit}, ${v.razonSocial}, NULL, ${v.municipio}, ${v.direccion}, ${v.leyenda}, 'simulado', NULL, ${d.permiteConsumidorFinal}, ${d.habilitada}, ${d.regimen}, ${JSON.stringify(d.codigosPago)}::jsonb, ${d.codigosConfirmados}, ${enviaCred}, ${d.tokenVenceEn ?? null}::date, ${userId}::uuid, NULL)
        ON CONFLICT (restaurant_id) DO UPDATE SET nit = EXCLUDED.nit, legal_name = EXCLUDED.legal_name, municipality = EXCLUDED.municipality, address = EXCLUDED.address, legend = EXCLUDED.legend, mode = 'simulado',
          allow_final_consumer = EXCLUDED.allow_final_consumer, enabled = EXCLUDED.enabled, tax_regime = EXCLUDED.tax_regime, payment_codes = EXCLUDED.payment_codes, codes_confirmed = EXCLUDED.codes_confirmed,
          token_set = billing_settings.token_set OR EXCLUDED.token_set, token_expires_on = COALESCE(EXCLUDED.token_expires_on, billing_settings.token_expires_on), updated_by = EXCLUDED.updated_by, updated_at = now(), connected_at = NULL`);
      await auditar(tx, t.restaurantId, userId, 'facturacion.datos_sin_guardados', 'billing_settings', t.restaurantId, { nit: v.nit, habilitada: d.habilitada, credencialEnviada: enviaCred });
    });
    let sincronizada = false; let mensaje: string | null = null; let codigo: string | null = null;
    try {
      if (!(await this.conexion.conectada()) && !(await this.conexion.puedeEnlazar())) throw Object.assign(new Error('sin enlace'), { codigo: 'NO_CONFIGURADO' });
      await (await this.conexion.enlace()).asegurarEmpresa(t.restaurantId, {
        nit: v.nit, razonSocial: v.razonSocial, municipio: v.municipio, direccion: v.direccion,
        ...(enviaCred ? { credencialesSin: { codigoSistema: d.codigoSistema!, tokenDelegado: d.tokenDelegado!, ...(d.tokenVenceEn ? { tokenVenceEn: `${d.tokenVenceEn}T23:59:59Z` } : {}) } } : {}),
      });
      await this.db.run(t, (tx) => tx.execute(sql`UPDATE billing_settings SET connected_at = now() WHERE restaurant_id = ${t.restaurantId}`));
      sincronizada = true;
    } catch (e) { const m = mensajeIntegracion(e); mensaje = m.mensaje; codigo = m.codigo; }
    return { ...(await this.config(t)), sincronizada, ...(mensaje ? { mensaje, codigo } : {}) };
  }

  /* ------------------------------------------------------------------ conexión ------------------------------------------------------------------ */

  /**
   * Paso 3 «Probar facturación»: valida de punta a punta (credenciales del SIN, ambiente, catálogos, rubro, factura de prueba simulada y webhook) con
   * `POST /integraciones/empresas/{id}/probar` y lo dice en lenguaje simple. Si falta elegir el rubro lo avisa para mostrar el selector.
   */
  async probar(t: Tenant, userId: string) {
    const c = (await this.db.run(t, async (tx) => (await tx.execute(sql`SELECT nit, legal_name, municipality, address, connected_at FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0])) as { nit: string; legal_name: string; municipality: string; address: string; connected_at: string | null } | undefined;
    if (!c) throw new ConflictException('Primero completa los datos del SIN (paso 2).');
    let pasos: Array<{ id: string; titulo: string; estado: string; detalle: string; accion?: string }> = [];
    let listo = false; let resumen: string; let requiereRubro = false;
    try {
      const en = await this.conexion.enlace();
      if (!c.connected_at) { // la empresa aún no se sincronizó (FacturaSIN no respondía al guardar): se vuelve a enviar sin credenciales nuevas
        await en.asegurarEmpresa(t.restaurantId, { nit: c.nit, razonSocial: c.legal_name, municipio: c.municipality, direccion: c.address });
        await this.db.run(t, (tx) => tx.execute(sql`UPDATE billing_settings SET connected_at = now() WHERE restaurant_id = ${t.restaurantId}`));
      }
      const r = await en.probar(t.restaurantId, true);
      pasos = r.pasos;
      requiereRubro = pasos.some((p) => p.id === 'rubro' && p.estado !== 'ok');
      const falla = pasos.find((p) => p.estado === 'error');
      listo = !falla && r.ok !== false;
      resumen = listo ? 'Todo listo: ya puedes facturar. Las facturas de esta etapa son de prueba y no tienen validez fiscal.' : `Falta: ${falla?.detalle ?? 'revisar los pasos marcados'}`;
    } catch (e) { const m = mensajeIntegracion(e); resumen = m.mensaje; requiereRubro = m.codigo === 'REQUIERE_ELEGIR_RUBRO'; }
    await this.db.run(t, async (tx) => {
      await tx.execute(sql`UPDATE billing_settings SET last_test_at = now(), last_test_ok = ${listo}, last_test_message = ${resumen.slice(0, 300)} WHERE restaurant_id = ${t.restaurantId}`);
      await auditar(tx, t.restaurantId, userId, 'facturacion.probada', 'billing_settings', t.restaurantId, { ok: listo });
    });
    return { ok: listo, listo, resumen, pasos, requiereRubro, aviso: AVISO_PRUEBAS };
  }

  /** Selector simple de rubro (solo si FacturaSIN responde 409 REQUIERE_ELEGIR_RUBRO): del catálogo SINCRONIZADO de la empresa; no se inventa nada. */
  async rubros(t: Tenant) {
    try { return await (await this.conexion.enlace()).rubros(t.restaurantId); } catch (e) { throw new ServiceUnavailableException(mensajeIntegracion(e).mensaje); }
  }
  async elegirRubro(t: Tenant, userId: string, cuerpo: unknown) {
    const o = z.object({ actividadEconomica: z.string().regex(/^\d{4,8}$/), codigoProductoSin: z.string().regex(/^\d{3,10}$/), unidadMedida: z.number().int().optional() }).strict().parse(cuerpo);
    try {
      const r = await (await this.conexion.enlace()).elegirRubro(t.restaurantId, o);
      await this.db.run(t, (tx) => auditar(tx, t.restaurantId, userId, 'facturacion.rubro_elegido', 'billing_settings', t.restaurantId, { actividad: o.actividadEconomica }));
      return r;
    } catch (e) { throw new UnprocessableEntityException(mensajeIntegracion(e).mensaje); }
  }

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

  private mensajeDe(e: unknown): string {
    if (e instanceof FacturaSinError) return `${e.codigo}: ${e.message.replace(/^[A-Z_]+: /, '')}`;
    if (e instanceof HttpException) { const r = e.getResponse() as { message?: string }; return typeof r === 'string' ? r : r.message ?? e.message; }
    const m = (e as Error)?.message ?? String(e);
    return /timeout|abort/i.test(m) ? 'FacturaSIN no respondió a tiempo.' : m.replace(/client_secret=[^&\s]*/gi, 'client_secret=***');
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
      const cfg = (await tx.execute(sql`SELECT branch_code, pos_code, enabled, allow_final_consumer, payment_codes FROM billing_settings WHERE restaurant_id = ${t.restaurantId}`)).rows[0] as
        { branch_code: number; pos_code: number; enabled: boolean; allow_final_consumer: boolean; payment_codes: CodigosPago | null } | undefined;
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
      try { payload = armarPayload({ idExterno, lineas: lp, descuento: o.discount, comprador, metodo: pago.method, numeroTarjeta, config: { sucursal: cfg.branch_code, puntoVenta: cfg.pos_code, codigosPago: cfg.payment_codes ?? undefined } }); }
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
      fs_total = ${Number.isFinite(totalFs) ? totalFs.toFixed(2) : null}::numeric, fs_iva = ${Number.isFinite(ivaFs) ? ivaFs.toFixed(2) : null}::numeric, links = ${JSON.stringify(r.enlaces ?? null)}::jsonb, snapshot = ${JSON.stringify(r)}::jsonb, qr_text = ${r.qrTexto ?? null},
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
    // Facturas ya emitidas pero sin la vista completa del SIN (aviso perdido o anterior a la columna): se consultan y se registran.
    const sinVista = await this.db.run(plat, async (tx) => (await tx.execute(sql`SELECT id::text, restaurant_id::text FROM fiscal_invoices WHERE fs_invoice_id IS NOT NULL AND snapshot IS NULL AND status IN ('validada','observada','contingencia','anulada') ORDER BY updated_at LIMIT 20`)).rows as { id: string; restaurant_id: string }[]);
    for (const x of sinVista) { try { if (await this.verificarPorId(x.restaurant_id, x.id)) conciliadas++; } catch { /* proximo ciclo */ } }
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

  /**
   * Aplica un evento YA verificado (el webhook único `/webhooks/facturasin` comprueba la firma HMAC con el secreto único del sistema). Registra la factura DEVUELTA por el SIN:
   * estado final, número, CUF, fecha, totales, desglose y enlaces en `snapshot`, de forma idempotente (id de evento) y sin retroceder por eventos viejos.
   */
  async aplicarEvento(ev: { id?: string; tipo?: string; creadoEn?: string; datos?: { idExterno?: string; facturaId?: string; cuf?: string; numero?: number; factura?: unknown; enlaces?: unknown } }, idEv: string): Promise<{ ok: boolean; estado?: string; ignorado?: string }> {
    const mapa: Record<string, string> = { 'factura.pendiente': 'pendiente', 'factura.validada': 'validada', 'factura.observada': 'observada', 'factura.rechazada': 'rechazada', 'factura.anulada': 'anulada', 'factura.contingencia': 'contingencia' };
    const estado = ev.tipo ? mapa[ev.tipo] : undefined;
    if (!estado || !ev.datos?.idExterno) return { ok: true, ignorado: 'evento sin efecto en facturas' };
    const rid = ((await this.bd.execute(sql`SELECT restaurant_id FROM fiscal_invoices WHERE external_id = ${ev.datos.idExterno}`)).rows[0] as { restaurant_id: string } | undefined)?.restaurant_id;
    if (!rid) return { ok: false };
    const t: Tenant = { restaurantId: rid, restaurantIds: [] };
    return this.db.run(t, async (tx) => {
      const nuevo = (await tx.execute(sql`INSERT INTO fiscal_webhook_events (event_id, restaurant_id, kind) VALUES (${idEv}, ${rid}, ${ev.tipo!}) ON CONFLICT DO NOTHING RETURNING event_id`)).rows.length > 0;
      if (!nuevo) return { ok: true, ignorado: 'duplicado' };
      const f = (await tx.execute(sql`SELECT ${COLUMNAS} FROM fiscal_invoices WHERE restaurant_id = ${rid} AND external_id = ${ev.datos!.idExterno!}`)).rows[0] as unknown as Fila | undefined;
      if (!f) return { ok: false };
      const cuando = ev.creadoEn && !Number.isNaN(Date.parse(ev.creadoEn)) ? new Date(ev.creadoEn) : new Date();
      if (f.last_event_at && cuando.getTime() < new Date(f.last_event_at).getTime()) return { ok: true, ignorado: 'evento anterior al último aplicado' };
      if (f.status === 'anulada' && estado !== 'anulada') return { ok: true, ignorado: 'la factura ya está anulada' };
      await tx.execute(sql`UPDATE fiscal_invoices SET status = ${estado}, fs_invoice_id = COALESCE(fs_invoice_id, ${ev.datos!.facturaId ?? null}), cuf = COALESCE(${ev.datos!.cuf ?? null}, cuf), invoice_number = COALESCE(${ev.datos!.numero ?? null}::bigint, invoice_number),
        snapshot = COALESCE(${ev.datos!.factura ? JSON.stringify(ev.datos!.factura) : null}::jsonb, snapshot), links = COALESCE(${ev.datos!.enlaces ? JSON.stringify(ev.datos!.enlaces) : null}::jsonb, links), last_event_at = ${cuando.toISOString()}::timestamptz,
        next_retry_at = CASE WHEN ${estado} = 'pendiente' THEN next_retry_at ELSE NULL END,
        last_error = CASE WHEN ${estado} IN ('validada','observada','anulada') THEN NULL ELSE last_error END, updated_at = now() WHERE id = ${f.id}::uuid`);
      if (estado !== 'pendiente') await this.resolverAlerta(tx, rid, `pendiente:${f.id}`);
      await auditar(tx, rid, null, 'factura.webhook', 'fiscal_invoice', f.id, { evento: ev.tipo, estado });
      return { ok: true, estado };
    });
  }

  /** Registra la factura DEVUELTA por el SIN (snapshot completo) de una factura de restaurante sin intervención del usuario (conciliación y «Reprocesar»). `true` si quedó registrada. */
  async verificarPorId(restaurantId: string, id: string): Promise<boolean> {
    const t: Tenant = { restaurantId, restaurantIds: [] };
    const f = await this.db.run(t, (tx) => this.cargar(tx, restaurantId, id));
    if (!f.external_id || ['en_cola', 'error_datos'].includes(f.status)) return false;
    const r = await (await this.cliente(1)).porIdExterno(f.external_id, restaurantId);
    await this.db.run(t, (tx) => this.aplicarRemoto(tx, f, r));
    return true;
  }

  /** Botón «Verificar»: reconsulta a FacturaSIN el estado FINAL de la factura (por id externo) y lo registra; si FacturaSIN no avisa, esto la deja al día. */
  async verificar(t: Tenant, _userId: string, id: string) {
    const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, id));
    if (['en_cola', 'error_datos'].includes(f.status)) return vistaFactura(f);
    try {
      const r = await (await this.cliente(1)).porIdExterno(f.external_id, t.restaurantId);
      await this.db.run(t, (tx) => this.aplicarRemoto(tx, f, r));
    } catch (e) { throw new ServiceUnavailableException(mensajeIntegracion(e).mensaje); }
    return this.vista(t, id);
  }

  /** «Reenviar aviso»: pide a FacturaSIN que vuelva a enviar el aviso firmado de esa factura (por si el sistema estuvo caído). */
  async reenviarAviso(t: Tenant, id: string) {
    const f = await this.db.run(t, (tx) => this.cargar(tx, t.restaurantId, id));
    if (!f.fs_invoice_id) throw new ConflictException('Esta factura todavía no llegó a FacturaSIN: no hay aviso que reenviar.');
    try { await (await this.conexion.enlace()).reenviarAviso(t.restaurantId, f.fs_invoice_id); } catch (e) { throw new ServiceUnavailableException(mensajeIntegracion(e).mensaje); }
    return { ok: true, mensaje: 'FacturaSIN reenviará el aviso firmado en unos segundos.' };
  }
}

export { TIPOS_DOCUMENTO };
