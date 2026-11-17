import { BadRequestException, ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor } from '../comun/acceso';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { entorno } from '../config/entorno';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { evaluarEntrega, normalizarEmpresa, urlWebhookDe } from './nucleo/integracion';
import { FacturaSinConexion } from './facturasin-conexion';
import { FacturacionEmisorService } from '../facturacion-emisor/facturacion-emisor.service';
import { IntegracionFacturaSinService, LLAVE_WEBHOOK } from './integracion-fs.service';
import { urlPublicaConocida } from './url-publica-conocida';
import {
  aceptaTransicion, aCentavos, BOM, codigosFiscalesFaltantes, evaluarRegimenFiscal, TEXTO_AVISO_CODIGOS, celdaNumero, celdaTexto, deCentavos, emitirFactura, estadoLocalDe, FacturaSinClient, FacturaSinError, filaCsv, ivaPorDentro, validarDatosFiscales,
  type AlmacenFacturas, type ConfigEmision, type DatosIntento, type EstadoLocal, type EventoWebhook, type FilaFactura, type PagoFacturable, type Resultado, type ResultadoGuardado,
} from './nucleo';

const LLAVE_CONFIG = 'facturacion.kyros';
const OCULTAR = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/** Configuración NO secreta de la integración. El secreto del client (gestro-service) vive en el catálogo de integraciones (cifrado, solo escritura). */
export const ConfigFacturacion = z.object({
  activo: z.boolean(),
  url: z.string().trim().max(200).refine((u) => { try { const x = new URL(u); return x.protocol === 'https:' || (!entorno.produccion && x.protocol === 'http:' && OCULTAR.test(x.hostname)); } catch { return false; } }, 'La URL de FacturaSIN debe ser https (http solo en desarrollo local).'),
  issuer: z.string().trim().max(200).nullable(),
  clientId: z.string().trim().regex(/^[a-z][a-z0-9-]{2,60}$/),
  sistema: z.string().trim().regex(/^[a-z][a-z0-9-]{1,30}$/),
  empresa: z.string().trim().regex(/^[a-z][a-z0-9-]{1,40}$/),
  sector: z.number().int().min(1).max(99), sucursal: z.number().int().min(0).max(999), puntoVenta: z.number().int().min(0).max(999),
  metodoPago: z.number().int().min(1).max(99), codigoProducto: z.string().trim().min(1).max(60),
  /**
   * Códigos fiscales que GESTRO ENVÍA en cada ítem de la factura de Kyros-Tech (FacturaSIN no registra los productos de los sistemas Kyros).
   * Se eligen del catálogo sincronizado de FacturaSIN (`GET /v1/catalog/{nombre}`). Predeterminados: provisionales de pruebas, NO CONFIRMADOS.
   */
  codigoProductoSin: z.string().trim().regex(/^\d{3,8}$/, 'El código de producto SIN son de 3 a 8 dígitos'),
  actividadEconomica: z.string().trim().regex(/^\d{4,8}$/, 'La actividad económica son de 4 a 8 dígitos'),
  unidadMedida: z.number().int().min(1).max(999),
  autoEmitir: z.boolean(),
  /** Interruptor del IVA «por fuera» (Ley 1733): APAGADO hasta que se publique el decreto reglamentario. */
  modoIva: z.enum(['por_dentro', 'por_fuera']),
  /** El contador confirmó los códigos (producto SIN, actividad, método de pago) contra el catálogo sincronizado. Mientras sea false, el panel avisa. */
  codigosConfirmados: z.boolean(),
}).strict();
export type ConfigFacturacionT = z.infer<typeof ConfigFacturacion>;
/** Encendida por defecto: solo actua cuando la conexion con FacturaSIN esta lista (credencial enlazada); todo es de prueba mientras FacturaSIN opere en simulacion. */
export const CONFIG_POR_DEFECTO: ConfigFacturacionT = {
  activo: true, url: 'https://facturasin.kyros-tech.com/api', issuer: null, clientId: 'gestro-service', sistema: 'gestro', empresa: 'kyros-tech',
  sector: 1, sucursal: 0, puntoVenta: 0, metodoPago: 7, codigoProducto: 'SUSC-MENSUAL', codigoProductoSin: '83141', actividadEconomica: '620100', unidadMedida: 58, autoEmitir: true,
  // codigoProductoSin/actividadEconomica/unidadMedida: NO CONFIRMADO — provisional de pruebas (catálogo SIMULADO de FacturaSIN).
  // metodoPago 7 y SUSC-MENSUAL: NO CONFIRMADO — definir con el catálogo del SIN (FacturaSIN: GET /v1/catalog/metodoPago).
  modoIva: 'por_dentro', codigosConfirmados: false,
};
export const ConfigParcial = ConfigFacturacion.partial();

export const FiltroLista = z.object({
  estado: z.enum(['todos', 'pendiente', 'emitida', 'simulada', 'rechazada', 'anulada']).default('todos'),
  cliente: z.string().trim().max(80).optional(),
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
  desde: z.coerce.number().int().min(0).max(100000).default(0),
});
export type FiltroListaT = z.infer<typeof FiltroLista>;
export const Emitir = z.object({ consumidorFinal: z.boolean().optional(), excepcionNit: z.boolean().optional() }).strict();
export const Anular = z.object({ motivo: z.number().int().min(1).max(4), comentario: z.string().trim().min(3).max(200) }).strict();
export const DatosFiscalesBody = z.object({
  regimen: z.enum(['general', 'simplificado', 'no_declarado']).default('no_declarado'),
  tipo: z.enum(['NIT', 'CI', 'CEX', 'PAS']).default('NIT'), numero: z.string().trim().max(30).nullable().optional(), complemento: z.string().trim().max(5).nullable().optional(),
  razonSocial: z.string().trim().max(160), correo: z.string().trim().max(120).nullable().optional(),
}).strict();

export const CATALOGOS_LEGIBLES = ['productosServicios', 'actividades', 'unidadMedida', 'metodoPago'];
const likeSeguro = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
type Fila = Record<string, unknown>;

@Injectable()
export class FacturacionKyrosService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('FacturacionKyros');
  private reloj?: NodeJS.Timeout;
  private ocupado = false;

  constructor(
    @Inject(BD) private readonly bd: Bd,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(ConfiguracionService) private readonly cfg: ConfiguracionService,
    @Inject(IntegracionFacturaSinService) private readonly integracion: IntegracionFacturaSinService,
    @Inject(FacturaSinConexion) private readonly conexion: FacturaSinConexion,
    @Inject(FacturacionEmisorService) private readonly emisor: FacturacionEmisorService,
  ) {}

  /** Cada 5 min: concilia lo pendiente y emite lo que quedó sin factura. En las pruebas se invoca a mano. */
  onModuleInit() {
    if (process.env.VITEST === undefined) this.reloj = setInterval(() => { void this.ciclo().catch((e) => this.log.warn(String(e?.message ?? e))); }, 5 * 60_000);
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /* ---------------- configuración ---------------- */

  async config(): Promise<ConfigFacturacionT> { const c = { ...CONFIG_POR_DEFECTO, ...((await this.cfg.leer<Partial<ConfigFacturacionT>>(LLAVE_CONFIG)) ?? {}) }; return { ...c, empresa: normalizarEmpresa(c.sistema, c.empresa) }; }

  async guardarConfig(a: Actor, d: z.infer<typeof ConfigParcial>) {
    const nueva = ConfigFacturacion.parse({ ...(await this.config()), ...d });
    await this.cfg.guardar(LLAVE_CONFIG, nueva, a.sub);
    await this.auditar(null, a.sub, 'facturacion_kyros.config_guardada', 'config', { ...nueva });
    return this.estadoIntegracion();
  }

  /** Estado de la integración para la pantalla: nunca devuelve secretos. */
  async estadoIntegracion() {
    const c = await this.config();
    const sec = (await this.conexion.tipoCredencial()) !== 'ninguna';
    const wh = await this.cfg.leer<{ secretos: string[] }>(LLAVE_WEBHOOK);
    return { config: c, secretoConfigurado: sec, urlWebhook: urlPublicaConocida() ? urlWebhookDe(urlPublicaConocida()!) : null, enlace: await this.integracion.estado(), webhookConfigurado: !!wh?.secretos?.length, lista: c.activo && sec, codigosSinFaltan: codigosFiscalesFaltantes(c), avisoCodigos: c.codigosConfirmados ? null : TEXTO_AVISO_CODIGOS, ivaPorFueraVigente: false };
  }

  /**
   * Valores de un catálogo sincronizado de FacturaSIN (`productosServicios`, `actividades`, `unidadMedida`, `metodoPago`) para ELEGIR los códigos.
   * Nunca lanza: si no se puede consultar devuelve `disponible: false` con qué configurar y dónde (no el error de «registrar productos en FacturaSIN»).
   */
  async catalogo(nombre: string): Promise<{ nombre: string; disponible: boolean; items: Array<Record<string, unknown>>; aviso: string | null }> {
    if (!CATALOGOS_LEGIBLES.includes(nombre)) throw new BadRequestException(`Catálogo no válido (${CATALOGOS_LEGIBLES.join(', ')}).`);
    const config = await this.config(); const cliente = await this.cliente(config, true);
    const manual = 'o escribe los códigos a mano en Facturación → Códigos fiscales del producto';
    if (!cliente) return { nombre, disponible: false, items: [], aviso: `No se puede consultar el catálogo de FacturaSIN: falta el secreto de gestro-service (Integraciones › KYROS_SERVICE_CLIENT_SECRET); ${manual}.` };
    try {
      const r = await cliente.catalogo(config.empresa, nombre);
      const items = Array.isArray(r?.items) ? r.items : [];
      return { nombre, disponible: items.length > 0, items, aviso: items.length ? null : `El catálogo «${nombre}» de la empresa ${config.sistema}:${config.empresa} aún no está sincronizado en FacturaSIN; sincronízalo allí ${manual}.` };
    } catch (e) {
      const fe = e instanceof FacturaSinError ? e : null;
      return { nombre, disponible: false, items: [], aviso: `No se pudo consultar el catálogo de FacturaSIN (${fe ? `${fe.codigo} HTTP ${fe.estado}` : 'sin respuesta'}). Revisa la conexión y el secreto de gestro-service ${manual}.` };
    }
  }

  /** `soloLectura`: para leer catálogos no hace falta el interruptor de emisión (solo el secreto y el emisor). */
  private async cliente(c?: ConfigFacturacionT, soloLectura = false): Promise<FacturaSinClient | null> {
    const conf = c ?? (await this.config());
    if (!conf.activo && !soloLectura) return null;
    return this.conexion.cliente(2);
  }

  /* ---------------- pagos y almacén ---------------- */

  private async cargarPago(pagoId: string): Promise<(PagoFacturable & { restaurantId: string; cuentaId: string; estadoPago: string }) | null> {
    const r = (await this.bd.execute(sql`SELECT p.id, p.status, p.restaurant_id, r.account_id, p.months_paid, p.gift_months, (p.amount_bob * 100)::bigint::text AS cent, p.period_from::text AS desde, p.period_to::text AS hasta,
        p.fx_usd_bob::text AS fx, p.fx_fecha::text AS fx_fecha, pl.name AS plan, pl.monthly_price_usd::text AS usd, a.legal_name, a.nit, a.fiscal_doc_type, a.fiscal_doc_complement, a.fiscal_email
      FROM subscription_payments p JOIN restaurants r ON r.id = p.restaurant_id JOIN accounts a ON a.id = r.account_id LEFT JOIN plans pl ON pl.id = r.plan_id WHERE p.id = ${pagoId}`)).rows[0] as Fila | undefined;
    if (!r) return null;
    return {
      pagoId, restaurantId: String(r.restaurant_id), cuentaId: String(r.account_id), estadoPago: String(r.status), plan: (r.plan as string) ?? null, meses: Number(r.months_paid), mesesDeRegalo: Number(r.gift_months),
      montoCent: BigInt(String(r.cent)), desde: (r.desde as string) ?? null, hasta: (r.hasta as string) ?? null, precioUsd: (r.usd as string) ?? null,
      tco: r.fx ? { usdBob: String(r.fx), fecha: String(r.fx_fecha ?? '') } : null,
      fiscales: { tipo: r.fiscal_doc_type as string, numero: r.nit as string | null, complemento: r.fiscal_doc_complement as string | null, razonSocial: r.legal_name as string, correo: r.fiscal_email as string | null },
    };
  }

  private almacen(restaurantId: string, cuentaId: string, usuario: string | null): AlmacenFacturas {
    const fila = (x: Fila): FilaFactura => ({ id: String(x.id), pagoId: String(x.payment_id), estado: x.status as EstadoLocal, intentos: Number(x.attempts), claveIdempotencia: String(x.idempotency_key), facturasinId: (x.facturasin_id as string) ?? null });
    return {
      obtener: async (pagoId) => { const x = (await this.bd.execute(sql`SELECT * FROM kyros_invoices WHERE payment_id = ${pagoId}`)).rows[0] as Fila | undefined; return x ? fila(x) : null; },
      iniciarIntento: async (pago, d: DatosIntento) => {
        const x = (await this.bd.execute(sql`INSERT INTO kyros_invoices (payment_id, restaurant_id, account_id, status, attempts, idempotency_key, total_bob_cent, iva_bob_cent, net_bob_cent, iva_mode, buyer_doc_type, buyer_doc_number, buyer_doc_complement, buyer_name, buyer_email, buyer_fallback, description, fx_usd_bob, fx_fecha, created_by, last_attempt_at)
          VALUES (${pago.pagoId}, ${restaurantId}, ${cuentaId}, 'emitiendo', 1, ${d.clave}, ${d.totalCent.toString()}::bigint, ${d.ivaCent.toString()}::bigint, ${d.netoCent.toString()}::bigint, ${d.modoIva}, ${d.comprador.tipo}, ${d.comprador.numero}, ${d.comprador.complemento}, ${d.comprador.razonSocial}, ${d.comprador.correo}, ${d.consumidorFinal}, ${d.descripcion}, ${pago.tco?.usdBob ?? null}, ${pago.tco?.fecha || null}, ${usuario}, now())
          ON CONFLICT (payment_id) DO UPDATE SET status = 'emitiendo', attempts = kyros_invoices.attempts + 1, idempotency_key = EXCLUDED.idempotency_key, total_bob_cent = EXCLUDED.total_bob_cent, iva_bob_cent = EXCLUDED.iva_bob_cent, net_bob_cent = EXCLUDED.net_bob_cent, iva_mode = EXCLUDED.iva_mode,
            buyer_doc_type = EXCLUDED.buyer_doc_type, buyer_doc_number = EXCLUDED.buyer_doc_number, buyer_doc_complement = EXCLUDED.buyer_doc_complement, buyer_name = EXCLUDED.buyer_name, buyer_email = EXCLUDED.buyer_email,
            buyer_fallback = EXCLUDED.buyer_fallback, description = EXCLUDED.description, last_attempt_at = now(), updated_at = now()
          RETURNING *`)).rows[0] as Fila;
        return fila(x);
      },
      guardarResultado: async (pagoId, r: ResultadoGuardado) => {
        await this.bd.execute(sql`UPDATE kyros_invoices SET status = ${r.estado}, facturasin_id = COALESCE(${r.facturasinId ?? null}, facturasin_id), cuf = COALESCE(${r.cuf ?? null}, cuf), invoice_number = COALESCE(${r.numero ?? null}, invoice_number),
          qr_text = COALESCE(${r.qrTexto ?? null}, qr_text), test_environment = COALESCE(${r.ambientePruebas ?? null}, test_environment), fiscal_notice = COALESCE(${r.avisoFiscal ?? null}, fiscal_notice),
          iva_fs_cent = COALESCE(${r.ivaFsCent === undefined || r.ivaFsCent === null ? null : r.ivaFsCent.toString()}::bigint, iva_fs_cent),
          last_error_code = ${r.errorCodigo ?? null}, last_error = ${r.error ?? null}, retryable = ${r.reintentable ?? true},
          emitted_at = CASE WHEN ${r.estado} = 'emitida' AND emitted_at IS NULL THEN now() ELSE emitted_at END, updated_at = now() WHERE payment_id = ${pagoId}`);
      },
    };
  }

  private async auditar(restaurantId: string | null, userId: string | null, accion: string, entidadId: string, despues: unknown) {
    await this.bd.execute(sql`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after) VALUES (${restaurantId}, ${userId}, ${accion}, 'kyros_invoice', ${entidadId}, ${JSON.stringify(despues)}::jsonb)`);
  }

  /* ---------------- emisión ---------------- */

  /**
   * Engancha con la validación del pago. NUNCA lanza ni bloquea: si FacturaSIN no está configurada o está caída, el pago ya quedó
   * validado y activado; la factura queda pendiente (alerta) y el ciclo de reintentos la resuelve.
   */
  async alValidarPago(pagoId: string, userId: string | null): Promise<void> {
    try {
      const c = await this.config();
      if (!c.activo || !c.autoEmitir) return;
      await this.emitirPago(pagoId, userId, {}, 'facturacion_kyros.emision_automatica');
    } catch (e) { this.log.warn(`Emisión automática del pago ${pagoId}: ${(e as Error).message}`); }
  }

  /** Emite (o reintenta) la factura de un pago VALIDADO. Devuelve el resultado; los fallos de FacturaSIN no lanzan. */
  async emitirPago(pagoId: string, userId: string | null, op: { consumidorFinal?: boolean; excepcionNit?: boolean }, accion = 'facturacion_kyros.emitir'): Promise<Resultado> {
    const pago = await this.cargarPago(pagoId);
    if (!pago) throw new NotFoundException('Pago no encontrado.');
    if (pago.estadoPago !== 'validado') throw new ConflictException('Solo se factura un pago validado: sin pago validado no hay factura.');
    const config = await this.config(); const cliente = await this.cliente(config);
    if (!cliente) return { ok: false, estado: 'pendiente', codigo: 'NO_CONFIGURADO', mensaje: 'La integración con FacturaSIN no está activa o falta el secreto de gestro-service.', reintentable: false };
    const ce: ConfigEmision = { sistema: config.sistema, empresa: config.empresa, sector: config.sector, sucursal: config.sucursal, puntoVenta: config.puntoVenta, metodoPago: config.metodoPago, codigoProducto: config.codigoProducto, codigoProductoSin: config.codigoProductoSin, actividadEconomica: config.actividadEconomica, unidadMedida: config.unidadMedida };
    const r = await emitirFactura({ almacen: this.almacen(pago.restaurantId, pago.cuentaId, userId), cliente, config: ce }, pago, op);
    await this.auditar(pago.restaurantId, userId, accion, pagoId, r.ok ? { estado: r.estado, yaExistia: r.yaExistia, ...op } : { codigo: r.codigo, mensaje: r.mensaje, ...op });
    return r;
  }

  async anular(a: Actor, facturaId: string, d: z.infer<typeof Anular>) {
    const f = (await this.bd.execute(sql`SELECT id, restaurant_id, status, facturasin_id FROM kyros_invoices WHERE id = ${facturaId}`)).rows[0] as Fila | undefined;
    if (!f) throw new NotFoundException('Factura no encontrada.');
    if (f.status !== 'emitida' || !f.facturasin_id) throw new ConflictException('Solo se anula una factura emitida y validada por el SIN.');
    const config = await this.config(); const cliente = await this.cliente(config);
    if (!cliente) throw new HttpException({ code: 'NO_CONFIGURADO', message: 'La integración con FacturaSIN no está activa.' }, 503);
    try { await cliente.anular(config.empresa, String(f.facturasin_id), d.motivo, d.comentario); }
    catch (e) {
      const fe = e instanceof FacturaSinError ? e : null;
      await this.auditar(String(f.restaurant_id), a.sub, 'facturacion_kyros.anulacion_fallida', facturaId, { codigo: fe?.codigo ?? 'ERROR_RED', motivo: d.motivo });
      throw new HttpException({ code: fe?.codigo ?? 'FACTURASIN_NO_DISPONIBLE', message: fe?.message ?? 'FacturaSIN no respondió; la factura sigue vigente.' }, fe && fe.estado < 500 ? 409 : 502);
    }
    await this.bd.execute(sql`UPDATE kyros_invoices SET status = 'anulada', void_reason_code = ${d.motivo}, void_comment = ${d.comentario}, voided_at = now(), voided_by = ${a.sub}, updated_at = now() WHERE id = ${facturaId}`);
    await this.auditar(String(f.restaurant_id), a.sub, 'facturacion_kyros.anulada', facturaId, d);
    return { ok: true, estado: 'anulada' as const };
  }

  /* ---------------- listado, totales y alertas ---------------- */

  private where(f: Pick<FiltroListaT, 'estado' | 'cliente' | 'mes'>) {
    const cond = [sql`p.status = 'validado'`];
    switch (f.estado) {
      case 'pendiente': cond.push(sql`(k.id IS NULL OR k.status IN ('pendiente','emitiendo'))`); break;
      case 'emitida': cond.push(sql`k.status = 'emitida'`); break;
      case 'simulada': cond.push(sql`k.status IN ('emitida','en_proceso','observada') AND k.test_environment`); break;
      case 'rechazada': cond.push(sql`k.status = 'rechazada'`); break;
      case 'anulada': cond.push(sql`k.status = 'anulada'`); break;
    }
    if (f.cliente) { const l = likeSeguro(f.cliente); cond.push(sql`(a.legal_name ILIKE ${l} OR r.name ILIKE ${l} OR COALESCE(a.nit,'') ILIKE ${l})`); }
    if (f.mes) cond.push(sql`to_char(p.validated_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM') = ${f.mes}`);
    return sql.join(cond, sql` AND `);
  }
  private readonly DESDE = sql`FROM subscription_payments p JOIN restaurants r ON r.id = p.restaurant_id JOIN accounts a ON a.id = r.account_id LEFT JOIN kyros_invoices k ON k.payment_id = p.id`;

  private vista(x: Fila) {
    const estado = (x.k_status as EstadoLocal | null) ?? 'pendiente';
    const emitidaSim = ['emitida', 'en_proceso', 'observada'].includes(estado) && x.k_test === true;
    const sinDatos = !x.k_id && !(x.nit && validarDatosFiscales({ tipo: x.doc_tipo as string, numero: x.nit as string, razonSocial: x.cuenta as string }).ok);
    return {
      pagoId: x.pago_id, facturaId: x.k_id ?? null, cliente: x.cuenta, sucursal: x.sucursal, nit: x.nit ?? null,
      monto: x.monto, validadoEn: x.validado_en ? new Date(String(x.validado_en)).toISOString() : null,
      estado, simulada: emitidaSim, sinFactura: !x.k_id || ['pendiente', 'emitiendo', 'rechazada'].includes(estado),
      numero: x.k_numero ?? null, cuf: x.k_cuf ?? null, total: x.k_total === null || x.k_total === undefined ? null : deCentavos(BigInt(String(x.k_total))), iva: x.k_iva === null || x.k_iva === undefined ? null : deCentavos(BigInt(String(x.k_iva))),
      comprador: x.k_id ? { nombre: x.k_nombre, documento: x.k_doc, consumidorFinal: x.k_cf } : null,
      intentos: x.k_intentos ?? 0, error: x.k_err ?? null, errorCodigo: x.k_errc ?? (sinDatos ? 'SIN_DATOS_FISCALES' : null), reintentable: x.k_retry ?? !sinDatos,
      avisoFiscal: x.k_aviso ?? null, motivoAnulacion: x.k_vcom ?? null, emitidaEn: x.k_emit ? new Date(String(x.k_emit)).toISOString() : null,
      horasSinFactura: ['emitida', 'anulada'].includes(estado) || !x.validado_en ? 0 : Math.max(0, Math.floor((Date.now() - new Date(String(x.validado_en)).getTime()) / 3_600_000)),
    };
  }

  async listar(f: FiltroListaT) {
    const filas = (await this.bd.execute(sql`SELECT p.id AS pago_id, a.legal_name AS cuenta, r.name AS sucursal, a.nit, a.fiscal_doc_type AS doc_tipo, p.amount_bob::text AS monto, p.validated_at AS validado_en,
        k.id AS k_id, k.status AS k_status, k.test_environment AS k_test, k.invoice_number AS k_numero, k.cuf AS k_cuf, k.total_bob_cent::text AS k_total, k.iva_bob_cent::text AS k_iva, k.buyer_name AS k_nombre,
        (k.buyer_doc_type || ' ' || k.buyer_doc_number) AS k_doc, k.buyer_fallback AS k_cf, k.attempts AS k_intentos, k.last_error AS k_err, k.last_error_code AS k_errc, k.retryable AS k_retry, k.fiscal_notice AS k_aviso, k.void_comment AS k_vcom, k.emitted_at AS k_emit
      ${this.DESDE} WHERE ${this.where(f)} ORDER BY p.validated_at DESC NULLS LAST, p.id LIMIT ${f.limite} OFFSET ${f.desde}`)).rows as Fila[];
    return { filas: filas.map((x) => this.vista(x)), totales: await this.totales(f), alertas: await this.alertas() };
  }

  /** Totales con recálculo independiente en SQL (enteros): el IVA guardado debe igualar round(total x 13 %) fila por fila y contra el de FacturaSIN. */
  async totales(f: Pick<FiltroListaT, 'estado' | 'cliente' | 'mes'>) {
    const x = (await this.bd.execute(sql`SELECT
        COUNT(*)::int AS pagos,
        COALESCE(SUM((p.amount_bob * 100)::bigint), 0)::text AS cobrado,
        COALESCE(SUM(k.total_bob_cent) FILTER (WHERE k.status IN ('emitida','en_proceso','observada')), 0)::text AS facturado,
        COALESCE(SUM(k.iva_bob_cent) FILTER (WHERE k.status IN ('emitida','en_proceso','observada')), 0)::text AS iva,
        COALESCE(SUM((k.total_bob_cent * 1300 + 5000) / 10000) FILTER (WHERE k.status IN ('emitida','en_proceso','observada')), 0)::text AS iva_recalculado,
        COALESCE(SUM(k.total_bob_cent) FILTER (WHERE k.status = 'anulada'), 0)::text AS anulado,
        COALESCE(SUM((p.amount_bob * 100)::bigint) FILTER (WHERE k.id IS NULL OR k.status IN ('pendiente','emitiendo','rechazada')), 0)::text AS por_facturar,
        COUNT(*) FILTER (WHERE k.status IN ('emitida','en_proceso','observada') AND k.iva_bob_cent <> (k.total_bob_cent * 1300 + 5000) / 10000)::int AS iva_distinto,
        COUNT(*) FILTER (WHERE k.iva_fs_cent IS NOT NULL AND k.iva_fs_cent <> k.iva_bob_cent)::int AS iva_distinto_fs,
        COUNT(*) FILTER (WHERE k.status IN ('emitida','en_proceso','observada') AND k.total_bob_cent <> (p.amount_bob * 100)::bigint)::int AS total_distinto_pago
      ${this.DESDE} WHERE ${this.where(f)}`)).rows[0] as Fila;
    const g = (k: string) => BigInt(String(x[k]));
    const neto = g('facturado');
    return {
      pagos: Number(x.pagos), cobrado: deCentavos(g('cobrado')), facturado: deCentavos(neto), iva: deCentavos(g('iva')), ivaRecalculado: deCentavos(g('iva_recalculado')), anulado: deCentavos(g('anulado')), porFacturar: deCentavos(g('por_facturar')),
      control: { ivaCoincide: g('iva') === g('iva_recalculado') && Number(x.iva_distinto) === 0, filasIvaDistinto: Number(x.iva_distinto), filasIvaDistintoDeFacturaSin: Number(x.iva_distinto_fs), filasTotalDistintoDelPago: Number(x.total_distinto_pago) },
    };
  }

  /** Pagos validados sin factura vigente: 1 h = alerta, 24 h = crítica. Nunca bloquean nada. */
  async alertas() {
    const x = (await this.bd.execute(sql`SELECT
        COUNT(*) FILTER (WHERE k.id IS NULL OR k.status IN ('pendiente','emitiendo','rechazada'))::int AS sin_factura,
        COUNT(*) FILTER (WHERE (k.id IS NULL OR k.status IN ('pendiente','emitiendo','rechazada')) AND p.validated_at < now() - interval '1 hour')::int AS alerta,
        COUNT(*) FILTER (WHERE (k.id IS NULL OR k.status IN ('pendiente','emitiendo','rechazada')) AND p.validated_at < now() - interval '24 hours')::int AS criticas,
        COUNT(*) FILTER (WHERE k.status = 'rechazada')::int AS rechazadas,
        COUNT(*) FILTER (WHERE k.id IS NULL AND (a.nit IS NULL OR a.nit = ''))::int AS sin_datos_fiscales
      ${this.DESDE} WHERE p.status = 'validado'`)).rows[0] as Fila;
    const c = await this.config();
    return { sinFactura: Number(x.sin_factura), enAlerta: Number(x.alerta), criticas: Number(x.criticas), rechazadas: Number(x.rechazadas), sinDatosFiscales: Number(x.sin_datos_fiscales), integracionActiva: c.activo };
  }

  /** CSV con los mismos filtros. Texto neutralizado contra fórmulas; importes como números exactos. */
  async csv(f: Pick<FiltroListaT, 'estado' | 'cliente' | 'mes'>): Promise<string> {
    const r = await this.listar({ ...f, limite: 500, desde: 0 });
    const cab = ['Pago', 'Cliente', 'Sucursal', 'NIT', 'Validado', 'Estado', 'Simulada', 'Numero', 'CUF', 'Total Bs', 'IVA 13% Bs', 'Cobrado Bs', 'Comprador', 'Consumidor final', 'Error'];
    const lineas = r.filas.map((x) => filaCsv([
      celdaTexto(x.pagoId), celdaTexto(x.cliente), celdaTexto(x.sucursal), celdaTexto(x.nit), celdaTexto(x.validadoEn), celdaTexto(x.estado), celdaTexto(x.simulada ? 'si' : 'no'), celdaNumero((x.numero as number | null) ?? null), celdaTexto(x.cuf),
      celdaNumero(x.total), celdaNumero(x.iva), celdaNumero(String(x.monto)), celdaTexto(x.comprador?.nombre), celdaTexto(x.comprador?.consumidorFinal ? 'si' : 'no'), celdaTexto(x.error),
    ]));
    const t = r.totales;
    lineas.push(filaCsv([celdaTexto('TOTALES'), '', '', '', '', '', '', '', '', celdaNumero(t.facturado), celdaNumero(t.iva), celdaNumero(t.cobrado), '', '', celdaTexto(`Anulado ${t.anulado}; por facturar ${t.porFacturar}; IVA recalculado ${t.ivaRecalculado}; ambiente de pruebas / sin validez fiscal`)]));
    return BOM + [filaCsv(cab.map(celdaTexto)), ...lineas].join('\r\n') + '\r\n';
  }

  /* ---------------- documentos (PDF, XML, QR) ---------------- */

  async documento(facturaId: string, tipo: 'pdf' | 'xml' | 'qr', formato: 'a4' | 'rollo' = 'a4', restaurantId?: string): Promise<Buffer> {
    const f = (await this.bd.execute(sql`SELECT facturasin_id, restaurant_id FROM kyros_invoices WHERE id = ${facturaId}`)).rows[0] as Fila | undefined;
    if (!f || (restaurantId && f.restaurant_id !== restaurantId)) throw new NotFoundException('Factura no encontrada.');
    if (!f.facturasin_id) throw new ConflictException('Esta factura todavía no fue emitida.');
    const config = await this.config(); const cliente = await this.cliente(config);
    if (!cliente) throw new HttpException({ code: 'NO_CONFIGURADO', message: 'La integración con FacturaSIN no está activa.' }, 503);
    try {
      const id = String(f.facturasin_id);
      return tipo === 'pdf' ? await cliente.pdf(config.empresa, id, formato) : tipo === 'xml' ? await cliente.xml(config.empresa, id) : await cliente.qr(config.empresa, id);
    } catch (e) { throw new HttpException({ code: e instanceof FacturaSinError ? e.codigo : 'FACTURASIN_NO_DISPONIBLE', message: 'FacturaSIN no pudo entregar el documento ahora.' }, 502); }
  }

  /** Lado del cliente: sus propias facturas (RLS por sucursal). */
  async misFacturas(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT id, status, invoice_number, (total_bob_cent)::text AS total, (iva_bob_cent)::text AS iva, description, test_environment, fiscal_notice, emitted_at, buyer_name, buyer_doc_number FROM kyros_invoices WHERE restaurant_id = ${t.restaurantId} ORDER BY created_at DESC LIMIT 50`)).rows as Fila[];
      return r.map((x) => ({ id: x.id, estado: x.status, numero: x.invoice_number ?? null, total: deCentavos(BigInt(String(x.total))), iva: deCentavos(BigInt(String(x.iva))), descripcion: x.description, simulada: x.test_environment === true, avisoFiscal: x.fiscal_notice ?? null, emitidaEn: x.emitted_at ? new Date(String(x.emitted_at)).toISOString() : null, comprador: x.buyer_name, documento: x.buyer_doc_number }));
    });
  }

  /** Datos fiscales del cliente: el dueño los carga y corrige. */
  async datosFiscales(t: Tenant) {
    const r = (await this.bd.execute(sql`SELECT a.legal_name, a.nit, a.fiscal_doc_type, a.fiscal_doc_complement, a.fiscal_email, a.fiscal_regime FROM restaurants r JOIN accounts a ON a.id = r.account_id WHERE r.id = ${t.restaurantId}`)).rows[0] as Fila | undefined;
    if (!r) throw new NotFoundException();
    const regimen = String(r.fiscal_regime ?? 'no_declarado');
    return { tipo: r.fiscal_doc_type, numero: r.nit ?? null, complemento: r.fiscal_doc_complement ?? null, razonSocial: r.legal_name, correo: r.fiscal_email ?? null, regimen, avisos: evaluarRegimenFiscal({ regimen, nit: r.nit as string | null }).avisos };
  }
  async guardarDatosFiscales(t: Tenant, userId: string, d: z.infer<typeof DatosFiscalesBody>) {
    const vacio = !d.numero || !String(d.numero).trim();
    const v = vacio ? null : validarDatosFiscales({ tipo: d.tipo, numero: d.numero, complemento: d.complemento, razonSocial: d.razonSocial, correo: d.correo });
    if (v && !v.ok) throw new BadRequestException(v.errores.join(' '));
    if (vacio) { const rs = validarDatosFiscales({ tipo: 'CI', numero: '1234', razonSocial: d.razonSocial, correo: d.correo }); if (!rs.ok) throw new BadRequestException(rs.errores.join(' ')); }
    const x = v && v.ok ? v.datos : { tipo: d.tipo, numero: null, complemento: null, razonSocial: d.razonSocial.trim().replace(/\s+/g, ' '), correo: d.correo?.trim().toLowerCase() || null };
    await this.bd.execute(sql`UPDATE accounts SET legal_name = ${x.razonSocial}, nit = ${x.numero}, fiscal_doc_type = ${x.tipo}, fiscal_doc_complement = ${x.complemento ?? null}, fiscal_email = ${x.correo ?? null}, fiscal_regime = ${d.regimen} WHERE id = (SELECT account_id FROM restaurants WHERE id = ${t.restaurantId})`);
    await this.auditar(t.restaurantId, userId, 'facturacion_kyros.datos_fiscales', t.restaurantId, { tipo: x.tipo, tieneNumero: !!x.numero, regimen: d.regimen });
    // F10: avisa (no bloquea) si declara Régimen Simplificado o no tiene un NIT válido.
    return { ok: true, avisos: evaluarRegimenFiscal({ regimen: d.regimen, nit: x.tipo === 'NIT' ? x.numero : null }).avisos };
  }

  /* ---------------- webhook de retorno y conciliación ---------------- */

  /** «Verificar / Reintentar»: dispara lo mismo que el sistema hace solo (enlace de credenciales + webhook con la URL publica derivada). Sin contrasena, sin URL tecleada. */
  /** Panel: ultimas entregas del aviso (segun FacturaSIN) + entregas recibidas aqui. */
  entregasAviso() { return this.integracion.entregas(); }
  probarEntregaAviso() { return this.integracion.probarEntrega(); }
  verificarIntegracion(a: Actor, token?: string | null) { return this.integracion.verificar(a.sub, true, token); }

  /** Procesa una entrega firmada. Devuelve el código HTTP que debe recibir FacturaSIN. */
  /** Endpoint receptor: evalua la firma, aplica el evento y deja registro de la entrega (fecha, evento, factura, resultado) para el panel. */
  async recibirWebhook(cabeceraFirma: string, eventoId: string, crudo: string): Promise<{ http: number; resultado: string }> {
    const r = await this.aplicarWebhook(cabeceraFirma, eventoId, crudo);
    let tipo: string | null = null; let factura: string | null = null; let evId: string | null = eventoId || null;
    if (r.resultado !== 'firma_invalida') {
      try { const ev = JSON.parse(crudo) as { id?: string; tipo?: string; datos?: { facturaId?: string; idExterno?: string } }; tipo = ev.tipo ?? null; factura = ev.datos?.facturaId ?? ev.datos?.idExterno ?? null; evId = evId ?? ev.id ?? null; } catch { /* cuerpo invalido */ }
    }
    void this.integracion.registrarRecepcion({ eventoId: evId, tipo, factura, firmaOk: r.resultado !== 'firma_invalida', resultado: r.resultado });
    return r;
  }

  private async aplicarWebhook(cabeceraFirma: string, eventoId: string, crudo: string): Promise<{ http: number; resultado: string }> {
    const secretos = (await this.cfg.leer<{ secretos: string[] }>(LLAVE_WEBHOOK))?.secretos ?? [];
    const ev0 = evaluarEntrega(secretos, cabeceraFirma, crudo);
    if (ev0.http !== 200) return { http: ev0.http, resultado: ev0.resultado };
    const ev = ev0.evento as unknown as EventoWebhook;
    const id = eventoId || ev.id;
    const nuevo = (await this.bd.execute(sql`INSERT INTO kyros_invoice_events (event_id, kind) VALUES (${id}, ${ev.tipo}) ON CONFLICT DO NOTHING RETURNING 1`)).rows.length;
    if (!nuevo) return { http: 200, resultado: 'duplicado' };
    const f = (await this.bd.execute(sql`SELECT id, status, restaurant_id FROM kyros_invoices WHERE facturasin_id = ${ev.datos.facturaId ?? ''} OR idempotency_key = ${ev.datos.idExterno ?? ''} LIMIT 1`)).rows[0] as Fila | undefined;
    if (!f) { // no es de Kyros-Tech: es del Flujo 2 (restaurante). El mismo aviso unico lo registra el emisor.
      await this.bd.execute(sql`DELETE FROM kyros_invoice_events WHERE event_id = ${id}`);
      const r2 = await this.emisor.aplicarEvento(ev as never, id);
      return { http: 200, resultado: r2.ok ? (r2.estado ? 'aplicado' : String(r2.ignorado ?? 'sin_cambio')) : 'factura_desconocida' };
    }
    const destino = estadoLocalDe(ev.datos.estado ?? ev.tipo.replace('factura.', ''));
    await this.bd.execute(sql`UPDATE kyros_invoice_events SET invoice_id = ${String(f.id)} WHERE event_id = ${id}`);
    if (!aceptaTransicion(f.status as EstadoLocal, destino)) return { http: 200, resultado: 'sin_cambio' };
    await this.bd.execute(sql`UPDATE kyros_invoices SET status = ${destino}, facturasin_id = COALESCE(facturasin_id, ${ev.datos.facturaId ?? null}), cuf = COALESCE(${ev.datos.cuf ?? null}, cuf), invoice_number = COALESCE(${ev.datos.numero ?? null}, invoice_number),
      emitted_at = CASE WHEN ${destino} = 'emitida' AND emitted_at IS NULL THEN now() ELSE emitted_at END, voided_at = CASE WHEN ${destino} = 'anulada' THEN COALESCE(voided_at, now()) ELSE voided_at END, updated_at = now() WHERE id = ${String(f.id)}`);
    await this.auditar(String(f.restaurant_id), null, 'facturacion_kyros.webhook', String(f.id), { evento: ev.tipo, estado: destino });
    return { http: 200, resultado: 'aplicado' };
  }

  /** Concilia lo que FacturaSIN dejó «en proceso», reintenta lo pendiente (con espera creciente) y emite lo que nunca se intentó. */
  async ciclo(): Promise<{ conciliadas: number; reintentadas: number; emitidas: number }> {
    if (this.ocupado) return { conciliadas: 0, reintentadas: 0, emitidas: 0 };
    this.ocupado = true;
    try {
      const config = await this.config(); const cliente = await this.cliente(config);
      if (!cliente) return { conciliadas: 0, reintentadas: 0, emitidas: 0 };
      let conciliadas = 0; let reintentadas = 0; let emitidas = 0;
      const vivas = (await this.bd.execute(sql`SELECT payment_id, idempotency_key, status, restaurant_id, id FROM kyros_invoices WHERE status IN ('en_proceso','observada') AND facturasin_id IS NOT NULL ORDER BY updated_at LIMIT 50`)).rows as Fila[];
      for (const k of vivas) {
        try {
          const f = await cliente.porIdExterno(String(k.idempotency_key), config.empresa);
          const destino = estadoLocalDe(f.estado);
          if (aceptaTransicion(k.status as EstadoLocal, destino)) {
            await this.bd.execute(sql`UPDATE kyros_invoices SET status = ${destino}, cuf = COALESCE(${f.cuf ?? null}, cuf), invoice_number = COALESCE(${f.numero ?? null}, invoice_number), emitted_at = CASE WHEN ${destino} = 'emitida' AND emitted_at IS NULL THEN now() ELSE emitted_at END, updated_at = now() WHERE id = ${String(k.id)}`);
            await this.auditar(String(k.restaurant_id), null, 'facturacion_kyros.conciliada', String(k.id), { estado: destino }); conciliadas++;
          }
        } catch { /* se reintenta en el próximo ciclo */ }
      }
      const reint = (await this.bd.execute(sql`SELECT payment_id FROM kyros_invoices WHERE (status = 'pendiente' AND retryable AND attempts < 12 AND last_attempt_at < now() - (LEAST(60, power(2, attempts))::int || ' minutes')::interval)
          OR (status = 'emitiendo' AND last_attempt_at < now() - interval '2 minutes') ORDER BY last_attempt_at LIMIT 20`)).rows as Fila[];
      for (const k of reint) { const r = await this.emitirPago(String(k.payment_id), null, {}, 'facturacion_kyros.reintento_automatico').catch(() => null); if (r) reintentadas++; }
      if (config.autoEmitir) {
        const nuevos = (await this.bd.execute(sql`SELECT p.id FROM subscription_payments p JOIN restaurants r ON r.id = p.restaurant_id JOIN accounts a ON a.id = r.account_id LEFT JOIN kyros_invoices k ON k.payment_id = p.id
          WHERE p.status = 'validado' AND k.id IS NULL AND a.nit IS NOT NULL AND a.nit <> '' AND p.validated_at > now() - interval '30 days' ORDER BY p.validated_at LIMIT 20`)).rows as Fila[];
        for (const p of nuevos) { const r = await this.emitirPago(String(p.id), null, {}, 'facturacion_kyros.emision_automatica').catch(() => null); if (r?.ok) emitidas++; }
      }
      return { conciliadas, reintentadas, emitidas };
    } finally { this.ocupado = false; }
  }

  /** Para el control del informe: recalcula el IVA de un importe (mismo cálculo que la factura). */
  static iva(monto: string) { return deCentavos(ivaPorDentro(aCentavos(monto))); }
}
