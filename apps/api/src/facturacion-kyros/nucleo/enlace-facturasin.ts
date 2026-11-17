/**
 * NÚCLEO DE ENLACE CON FACTURASIN (versión 1.1.0, interfaz v1). COPIAR TAL CUAL a cada sistema (Kyros o externo); no se edita por sistema.
 * Fuente única: facturasin/sdk/nucleo-enlace/enlace-facturasin.ts. Si cambia, sube NUCLEO_ENLACE_VERSION y se vuelve a copiar.
 *
 * Qué resuelve (cero configuración manual):
 *  - Obtiene la credencial de servicio de FacturaSIN SOLA (`POST /v1/integraciones/enlazar`) y la guarda con el almacén CIFRADO del sistema.
 *  - Si FacturaSIN responde 401 (credencial rotada/revocada), se vuelve a enlazar UNA vez y reintenta (idempotente: no duplica empresas ni webhooks).
 *  - Asegura empresas del sistema (`PUT /v1/integraciones/empresas/{tenantId}`), el rubro, el webhook (URL pública derivada de la petición,
 *    re-suscripción sola si el dominio cambia), la habilitación por plan y «Probar facturación».
 *
 * Sin dependencias: solo `fetch` y `node:crypto` (Node >= 20). Nunca escribe secretos en logs.
 * Arranque de enlace (elige lo que el sistema tenga; el orden es el de la lista):
 *   1) `credencialPuente()`: JWT client_credentials de `<sistema>-service` (lo ya configurado; RETIRO 31/03/2027).
 *   2) `secretoPlataforma()`: secreto `kyros-platform` que el sistema recibe de la plataforma (no de una persona técnica).
 *   3) `tokenArranque()`: access token del ADMINISTRADOR DE PLATAFORMA de Kyros ID (claim `kyros_pa`, 2FA obligatoria) que ya inició sesión en el
 *      `<sistema>-web`. Es la vía de un sistema NUEVO o de un despliegue sin secreto previo: el administrador pulsa «Conectar y probar» UNA vez y el
 *      servidor llama `conectarYProbar({ token })`. FacturaSIN deduce el sistema del `azp` (`<sistema>-web`) y no acepta otro.
 *   Cambios 1.1.0: `tokenArranque` (sustituye a `tokenUsuarioSuperadmin`, que sigue como alias), `enlazarConToken()` y `conectarYProbar()`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const NUCLEO_ENLACE_VERSION = '1.1.0';
export const INTERFAZ_FACTURASIN = '1';

/** Almacén de la credencial en la BD del sistema (el sistema la guarda CIFRADA; este núcleo solo la lee y la escribe). */
export interface AlmacenCredencial {
  leer(): Promise<string | null>;
  guardar(valor: string): Promise<void>;
}

export interface OpcionesEnlace {
  /** `https://facturasin.kyros-tech.com/api` (sin barra final). Es la ÚNICA URL fija; el sistema la trae por convención. */
  baseUrl: string;
  /** Id de sistema: `vet`, `axion`, `glucora`, `hub`, `medyx`, `dental`, `gestro` (o el de un sistema externo dado de alta). */
  sistema: string;
  almacen: AlmacenCredencial;
  credencialPuente?: () => Promise<string | null>;
  secretoPlataforma?: () => Promise<string | null>;
  /** Proveedor del token de arranque (access token del administrador de plataforma desde el `<sistema>-web`). */
  tokenArranque?: () => Promise<string | null>;
  /** @deprecated usa `tokenArranque`. */
  tokenUsuarioSuperadmin?: () => Promise<string | null>;
  version?: string;
  fetchImpl?: typeof fetch;
  /** Reintentos ante red/429/5xx (por defecto 3, espera exponencial). */
  reintentos?: number;
  esperar?: (ms: number) => Promise<void>;
  /** Aviso de operación (sin secretos). */
  log?: (mensaje: string) => void;
}

export class ErrorEnlace extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(`${codigo}: ${mensaje}`);
  }
}

export interface ResultadoEnlace {
  version: string;
  sistema: string;
  credencial: { id: string; valor: string; prefijo: string; creadaEn: string };
  empresaKyros: { empresaId: string; externo: string; razonSocial: string; nit: string; modoSiat: string; nitDePrueba: boolean; requiereRubro: boolean };
  permisos: string[];
  puente: { retiraEl: string };
}

export interface DatosEmpresa {
  nit: string;
  razonSocial: string;
  municipio: string;
  direccion?: string;
  telefono?: string;
  correo?: string;
  modalidad?: 1 | 2;
  sectores?: number[];
  /** Lo que da el SIN al cliente (paso «datos del SIN»). Nunca se guarda en el sistema: se envía a FacturaSIN y se descarta. */
  credencialesSin?: { codigoSistema: string; tokenDelegado: string; tokenVenceEn?: string; certificadoPem?: string; llavePrivadaPem?: string };
}

export interface PasoPrueba {
  id: string;
  titulo: string;
  estado: 'ok' | 'error' | 'aviso' | 'omitido';
  detalle: string;
  accion?: string;
}

export interface ItemLibre {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  descuento?: number;
  /** Opcionales: si el sistema los envía, mandan sobre el rubro de la empresa. */
  codigoProducto?: string;
  unidadMedida?: number;
  codigoProductoSin?: string;
  actividadEconomica?: string;
}

export interface FacturaAEmitir {
  idExterno: string;
  comprador: { tipoDocumento: 1 | 2 | 3 | 4 | 5; numeroDocumento: string; complemento?: string; razonSocial: string; correo?: string; codigoExcepcion?: 0 | 1 };
  items: ItemLibre[];
  metodoPago?: number;
  numeroTarjeta?: string;
  moneda?: number;
  tipoCambio?: number;
  descuentoAdicional?: number;
  ivaModo?: 'por_dentro' | 'por_fuera';
  sector?: number;
  extras?: Record<string, unknown>;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class EnlaceFacturaSin {
  private readonly f: typeof fetch;
  private readonly reintentos: number;
  private readonly esperar: (ms: number) => Promise<void>;
  private cache: string | null = null;
  private enlazando: Promise<string> | null = null;

  constructor(private readonly o: OpcionesEnlace) {
    this.f = o.fetchImpl ?? fetch;
    this.reintentos = o.reintentos ?? 3;
    this.esperar = o.esperar ?? dormir;
  }

  // ------------------------------------------------------------------------------------------------ credencial

  /** Devuelve la credencial guardada; si no hay, se enlaza sola (una sola llamada concurrente) y la guarda. */
  async credencial(): Promise<string> {
    if (this.cache) return this.cache;
    const guardada = await this.o.almacen.leer();
    if (guardada) return (this.cache = guardada);
    return this.enlazar();
  }

  /** Pide credencial nueva (idempotente en empresas/webhooks de FacturaSIN) y la guarda. */
  enlazar(): Promise<string> {
    this.enlazando ??= this.hacerEnlace().finally(() => {
      this.enlazando = null;
    });
    return this.enlazando;
  }

  private async hacerEnlace(): Promise<string> {
    const intentos: Array<[string, (() => Promise<string | null>) | undefined, 'bearer' | 'plataforma']> = [
      ['puente', this.o.credencialPuente, 'bearer'],
      ['plataforma', this.o.secretoPlataforma, 'plataforma'],
      ['administrador de plataforma', this.o.tokenArranque ?? this.o.tokenUsuarioSuperadmin, 'bearer'],
    ];
    let ultimo: unknown = new ErrorEnlace(0, 'SIN_ARRANQUE', 'El sistema no tiene con qué pedir su enlace a FacturaSIN (ni puente, ni secreto de plataforma, ni token del administrador de plataforma). Entra como administrador de plataforma y pulsa «Conectar y probar» una vez.');
    for (const [nombre, obtener, tipo] of intentos) {
      if (!obtener) continue;
      const valor = await obtener();
      if (!valor) continue;
      try {
        return await this.enlazarCon(nombre, tipo, valor);
      } catch (e) {
        ultimo = e;
        if (e instanceof ErrorEnlace && ![401, 403].includes(e.estado)) throw e;
      }
    }
    throw ultimo;
  }

  private async enlazarCon(nombre: string, tipo: 'bearer' | 'plataforma', valor: string): Promise<string> {
    const r = await this.http<ResultadoEnlace>('POST', '/v1/integraciones/enlazar', {
      cuerpo: { sistema: this.o.sistema, version: this.o.version ?? NUCLEO_ENLACE_VERSION },
      cab: tipo === 'bearer' ? { authorization: `Bearer ${valor}` } : { 'x-kyros-platform-secret': valor },
      sinCredencial: true,
    });
    await this.o.almacen.guardar(r.credencial.valor);
    this.cache = r.credencial.valor;
    this.o.log?.(`FacturaSIN enlazada (${nombre}); credencial ${r.credencial.prefijo}…`);
    return r.credencial.valor;
  }

  /** Enlaza con el access token del administrador de plataforma (el de su sesión en el `<sistema>-web`). Úsalo en «Conectar y probar». */
  enlazarConToken(tokenAdminPlataforma: string): Promise<string> {
    return this.enlazarCon('administrador de plataforma', 'bearer', tokenAdminPlataforma);
  }

  /**
   * «Conectar y probar» en UN paso: enlaza (con `token` si se da; si no, con lo que el sistema ya tenga), asegura el webhook con la URL pública
   * derivada de la petición (si la hay) y corre la prueba legible de la empresa (por defecto la de Kyros-Tech).
   */
  async conectarYProbar(o: { token?: string | null; urlPublica?: string | null; tenantId?: string; emitirPrueba?: boolean } = {}) {
    if (o.token) await this.enlazarConToken(o.token);
    else await this.credencial();
    const webhook = o.urlPublica ? await this.asegurarWebhook(o.urlPublica.replace(/\/$/, '') + RUTA_WEBHOOK_FACTURASIN) : null;
    const prueba = await this.probar(o.tenantId ?? 'kyros-tech', o.emitirPrueba ?? false);
    return { webhook, prueba };
  }

  // ------------------------------------------------------------------------------------------------ transporte

  private async http<T>(metodo: string, ruta: string, o: { cuerpo?: unknown; cab?: Record<string, string>; sinCredencial?: boolean; yaReenlazado?: boolean } = {}): Promise<T> {
    const cab: Record<string, string> = { ...(o.cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.cab ?? {}) };
    if (!o.sinCredencial) cab.authorization = `Bearer ${await this.credencial()}`;
    let ultimo: unknown;
    for (let i = 0; i <= this.reintentos; i++) {
      if (i > 0) await this.esperar(Math.min(6000, 400 * 2 ** (i - 1)) * (0.75 + Math.random() * 0.5));
      try {
        const res = await this.f(this.o.baseUrl.replace(/\/$/, '') + ruta, { method: metodo, headers: cab, body: o.cuerpo !== undefined ? JSON.stringify(o.cuerpo) : undefined });
        const texto = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(texto);
        } catch {
          /* no es JSON */
        }
        if (res.ok) return json as T;
        // Credencial rotada/revocada: se vuelve a enlazar UNA vez y se reintenta.
        if (res.status === 401 && !o.sinCredencial && !o.yaReenlazado) {
          this.cache = null;
          await this.o.almacen.guardar('').catch(() => undefined);
          await this.enlazar();
          return this.http<T>(metodo, ruta, { ...o, yaReenlazado: true });
        }
        const e = new ErrorEnlace(res.status, json?.codigo ?? 'ERROR_HTTP', json?.mensaje ?? (texto.slice(0, 200) || `HTTP ${res.status}`), json?.detalle);
        if (res.status !== 429 && res.status < 500) throw e;
        ultimo = e;
      } catch (e) {
        if (e instanceof ErrorEnlace && e.estado !== 429 && e.estado < 500) throw e;
        ultimo = e;
      }
    }
    throw ultimo instanceof Error ? ultimo : new ErrorEnlace(0, 'RED', 'No se pudo contactar a FacturaSIN');
  }

  private ext(tenantId: string) {
    return { 'x-empresa-externa': `${this.o.sistema}:${tenantId}` };
  }

  // ------------------------------------------------------------------------------------------------ operaciones del contrato v1

  estado() {
    return this.http<any>('GET', '/v1/integraciones/estado');
  }

  /** Crea/actualiza la empresa del cliente (`tenantId` = id de tu cliente). La de Kyros-Tech (`kyros-tech`) ya existe tras enlazar. */
  asegurarEmpresa(tenantId: string, d: DatosEmpresa) {
    return this.http<any>('PUT', `/v1/integraciones/empresas/${encodeURIComponent(tenantId)}`, { cuerpo: d });
  }
  rubros(tenantId: string) {
    return this.http<any>('GET', `/v1/integraciones/empresas/${encodeURIComponent(tenantId)}/rubros`);
  }
  elegirRubro(tenantId: string, r: { actividadEconomica: string; codigoProductoSin: string; unidadMedida?: number }) {
    return this.http<any>('PUT', `/v1/integraciones/empresas/${encodeURIComponent(tenantId)}/rubro`, { cuerpo: r });
  }
  /** «Probar facturación»: pasos legibles (credenciales SIN, ambiente, CUIS/CUFD, catálogos, rubro, factura de prueba, webhook). */
  probar(tenantId: string, emitirPrueba = false): Promise<{ ok: boolean; empresa: string; pasos: PasoPrueba[] }> {
    return this.http('POST', `/v1/integraciones/empresas/${encodeURIComponent(tenantId)}/probar`, { cuerpo: { emitirPrueba } });
  }
  /** ¿Se muestra «Facturación»? Si `habilitada` es false, mostrar el `mensaje` («No incluida en tu plan»). */
  habilitacion(tenantId: string): Promise<{ habilitada: boolean; origen: string; motivo: string | null; mensaje: string }> {
    return this.http('GET', `/v1/integraciones/habilitacion/${encodeURIComponent(tenantId)}`);
  }
  /** Declara lo que dice el plan del cliente (el SuperAdmin de FacturaSIN puede fijarlo por encima). */
  declararHabilitacion(tenantId: string, habilitada: boolean, motivo?: string) {
    return this.http<any>('PUT', `/v1/integraciones/habilitacion/${encodeURIComponent(tenantId)}`, { cuerpo: { habilitada, motivo } });
  }
  /**
   * Webhook idempotente. `tenantId` '*' (por defecto) = todas las empresas del sistema. Si `secreto` viene en la respuesta,
   * el sistema DEBE guardarlo cifrado (solo se entrega la primera vez o al rotar; es UNO por sistema).
   */
  asegurarWebhook(urlPublica: string, tenantId = '*', opciones: { eventos?: string[]; rotarSecreto?: boolean } = {}): Promise<{ suscripciones: Array<{ id: string; tenantId: string; url: string; estado: string }>; secreto: string | null }> {
    return this.http('PUT', '/v1/integraciones/webhooks', { cuerpo: { tenantId, url: urlPublica, ...opciones } });
  }
  emitir(tenantId: string, f: FacturaAEmitir, claveIdempotencia = f.idExterno): Promise<any> {
    return this.http('POST', '/v1/invoices', { cuerpo: f, cab: { ...this.ext(tenantId), 'idempotency-key': claveIdempotencia } });
  }
  consultarPorIdExterno(tenantId: string, idExterno: string): Promise<any> {
    return this.http('GET', `/v1/invoices/by-external/${encodeURIComponent(this.o.sistema)}/${encodeURIComponent(idExterno)}`, { cab: this.ext(tenantId) });
  }
  reenviarAviso(tenantId: string, facturaId: string): Promise<any> {
    return this.http('POST', `/v1/invoices/${encodeURIComponent(facturaId)}/resend-webhook`, { cab: this.ext(tenantId) });
  }
}

// -------------------------------------------------------------------------------------------------- utilidades de estándar

/**
 * URL PÚBLICA del propio sistema derivada de la petición (nunca de variables de entorno ni de localhost): respeta el proxy.
 * `cab` = cabeceras de la petición entrante (minúsculas). Devuelve `https://dominio` o null si no es pública (localhost/http).
 */
export function urlPublicaDesdePeticion(cab: Record<string, string | string[] | undefined>): string | null {
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  const host = un(cab['x-forwarded-host']) ?? un(cab['host']);
  const proto = un(cab['x-forwarded-proto']) ?? 'https';
  if (!host || proto !== 'https') return null;
  const h = host.toLowerCase().split(':')[0]!;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  return `https://${host}`;
}

/** Ruta estándar donde cada sistema recibe el aviso de FacturaSIN. */
export const RUTA_WEBHOOK_FACTURASIN = '/api/v1/webhooks/facturasin';

/**
 * Verifica `X-FacturaSIN-Signature` (HMAC-SHA256 de `t.cuerpo`, anti-replay 5 min, acepta dos firmas durante la rotación).
 * `secretos`: el vigente (y, si lo guardaste, el anterior).
 */
export function verificarFirmaWebhook(secretos: string | string[], cabecera: string, cuerpo: string, ahoraMs = Date.now()): boolean {
  const t = /t=(\d+)/.exec(cabecera);
  const firmas = [...cabecera.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]!);
  if (!t || !firmas.length) return false;
  const ts = Number(t[1]);
  if (Math.abs(ahoraMs / 1000 - ts) > 300) return false;
  let ok = false;
  for (const sec of ([] as string[]).concat(secretos)) {
    const esperado = Buffer.from(createHmac('sha256', sec).update(`${ts}.${cuerpo}`).digest('hex'), 'hex');
    for (const f of firmas) {
      const b = Buffer.from(f, 'hex');
      if (b.length === esperado.length && timingSafeEqual(b, esperado)) ok = true;
    }
  }
  return ok;
}

/** Datos que el sistema debe guardar de cada aviso: clave de deduplicación = `X-FacturaSIN-Event-Id` y `datos.facturaId + datos.estado`. */
export interface AvisoFactura {
  id: string;
  tipo: string;
  empresaId: string;
  creadoEn: string;
  datos: {
    facturaId: string;
    cuf: string | null;
    numero: number | null;
    estado: string;
    idExterno: string;
    ambientePruebas: boolean;
    version: number;
    reenvio?: boolean;
    factura: Record<string, any>;
    enlaces: { pdf: string; xml: string; qr: string | null };
    xml: string | null;
  };
}
