/**
 * COPIA de facturasin/sdk/client/src/index.ts (FacturaSIN, Fase 1) con un método añadido: qr(). Si FacturaSIN cambia su SDK, vuelve a copiarlo y reaplica qr().
 *
 * @facturasin/client: cliente mínimo de la API de FacturaSIN para los demás sistemas de Kyros.
 *
 * - Sin dependencias (solo `fetch` y `node:crypto` de Node >= 20): se puede COPIAR este archivo a otro repositorio.
 * - El secreto del client_credentials lo aporta quien llama (variables del propio sistema o su tabla de secretos):
 *   este paquete NUNCA lo guarda ni lo escribe en ningún log.
 * - Reintentos seguros: solo se reintenta ante fallos de red, 429 y 5xx; la `Idempotency-Key` es la misma en cada intento,
 *   así que un reintento nunca duplica una factura. Un rechazo del SIN (422 SIAT_RECHAZO) NO se reintenta: hay que corregir
 *   los datos y volver a emitir con OTRA clave.
 * - Verificación de webhooks: `verificarFirmaWebhook` (HMAC-SHA256, anti-replay de 5 minutos, rotación con dos firmas).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type EstadoFactura = 'pendiente' | 'validada' | 'observada' | 'rechazada' | 'anulada' | 'contingencia';

export interface Comprador {
  /** 1 CI · 2 CEX · 3 PAS · 4 OD · 5 NIT */
  tipoDocumento: 1 | 2 | 3 | 4 | 5;
  numeroDocumento: string;
  complemento?: string;
  razonSocial: string;
  correo?: string;
  /** 0 = el SIN valida el NIT del comprador; 1 = excepción (NIT inválido aceptado). */
  codigoExcepcion?: 0 | 1;
}

export interface ItemFactura {
  codigoProducto: string;
  descripcion: string;
  cantidad: number;
  unidadMedida?: number;
  precioUnitario: number;
  descuento?: number;
  codigoProductoSin?: string;
  actividadEconomica?: string;
}

export interface EmitirFactura {
  /** Id del cobro en TU sistema (p. ej. `gestro:pago-123`). También es la clave de idempotencia por defecto. */
  idExterno: string;
  sector?: number;
  sucursal?: number;
  puntoVenta?: number;
  comprador: Comprador;
  /** 1 efectivo · 2 tarjeta · 7 transferencia bancaria (catálogo del SIN). */
  metodoPago: number;
  numeroTarjeta?: string;
  /** 1 = Bs. Otra moneda exige `tipoCambio` igual al TCO del día (kyros-tech.com/api/v1/tipo-cambio). */
  moneda?: number;
  tipoCambio?: number | null;
  descuentoAdicional?: number;
  items: ItemFactura[];
  extras?: Record<string, unknown>;
}

export interface Factura {
  id: string;
  numero: number;
  cuf: string;
  estado: EstadoFactura;
  idExterno: string;
  fechaEmision: string;
  totales: { montoTotal: number; [k: string]: unknown };
  /** F4: texto «Ambiente de pruebas / sin validez fiscal» mientras la factura sea simulada; null si es real. */
  avisoFiscal: string | null;
  ambientePruebas: boolean;
  /** F8: rutas relativas a la API (piden el mismo Bearer). */
  enlaces: { detalle: string; pdf: string; pdfRollo: string; xml: string; qr: string };
  /** Texto exacto que lleva el QR de la factura. */
  qrTexto: string;
  errores?: unknown;
  [k: string]: unknown;
}

export interface ErrorApi {
  codigo: string;
  mensaje: string;
  detalle?: unknown;
}

export class FacturaSinError extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(`${codigo}: ${mensaje}`);
  }
  /** ¿Tiene sentido reintentar la MISMA petición (misma clave)? */
  get reintentable(): boolean {
    return this.estado === 429 || this.estado >= 500;
  }
}

export interface OpcionesCliente {
  /** Base de la API, p. ej. `https://facturasin.kyros-tech.com/api`. */
  baseUrl: string;
  /** Devuelve un Bearer vigente (usa `tokenClientCredentials` y cachea hasta que venza). */
  token: () => Promise<string>;
  /** Tu id de sistema de Kyros (`gestro`, `medyx`...). Va en `X-Empresa-Externa: <sistema>:<id>`. */
  sistema: string;
  /** Reintentos ante red/429/5xx (por defecto 4, con espera exponencial 0,5 s → 8 s y jitter). */
  reintentos?: number;
  fetchImpl?: typeof fetch;
  /** Para pruebas: sustituye la espera entre reintentos. */
  esperar?: (ms: number) => Promise<void>;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FacturaSinClient {
  private readonly f: typeof fetch;
  private readonly reintentos: number;
  private readonly esperar: (ms: number) => Promise<void>;

  constructor(private readonly o: OpcionesCliente) {
    this.f = o.fetchImpl ?? fetch;
    this.reintentos = o.reintentos ?? 4;
    this.esperar = o.esperar ?? dormir;
  }

  private async pedir(metodo: string, ruta: string, o: { cuerpo?: unknown; cab?: Record<string, string>; crudo?: boolean } = {}): Promise<any> {
    let ultimo: unknown;
    for (let intento = 0; intento <= this.reintentos; intento++) {
      if (intento > 0) await this.esperar(Math.min(8000, 500 * 2 ** (intento - 1)) * (0.75 + Math.random() * 0.5));
      try {
        const res = await this.f(this.o.baseUrl.replace(/\/$/, '') + ruta, {
          method: metodo,
          headers: { ...(o.cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${await this.o.token()}`, ...(o.cab ?? {}) },
          body: o.cuerpo !== undefined ? JSON.stringify(o.cuerpo) : undefined,
        });
        if (o.crudo && res.ok) return Buffer.from(await res.arrayBuffer());
        const texto = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(texto);
        } catch {
          /* no es JSON */
        }
        if (res.ok) return json;
        const e = new FacturaSinError(res.status, json?.codigo ?? 'ERROR_HTTP', json?.mensaje ?? (texto.slice(0, 200) || `HTTP ${res.status}`), json?.detalle);
        if (!e.reintentable) throw e;
        ultimo = e;
      } catch (e) {
        if (e instanceof FacturaSinError && !e.reintentable) throw e;
        ultimo = e; // red caída o 5xx/429: se reintenta con la MISMA Idempotency-Key
      }
    }
    throw ultimo;
  }

  private empresa(idEmpresaExterna: string) {
    return { 'x-empresa-externa': `${this.o.sistema}:${idEmpresaExterna}` };
  }

  /**
   * Emite una factura. Seguro de reintentar: la clave de idempotencia es `idExterno` salvo que indiques otra.
   * Con la misma clave y el mismo contenido siempre devuelve la MISMA factura.
   */
  emitir(idEmpresaExterna: string, d: EmitirFactura, claveIdempotencia = d.idExterno): Promise<Factura> {
    return this.pedir('POST', '/v1/invoices', {
      cuerpo: { sector: 1, sucursal: 0, puntoVenta: 0, moneda: 1, descuentoAdicional: 0, ...d },
      cab: { ...this.empresa(idEmpresaExterna), 'idempotency-key': claveIdempotencia },
    });
  }

  obtener(idEmpresaExterna: string, facturaId: string): Promise<Factura> {
    return this.pedir('GET', `/v1/invoices/${facturaId}`, { cab: this.empresa(idEmpresaExterna) });
  }

  /** Consulta por el id de tu sistema (`idExterno`), con o sin el prefijo `sistema:`. */
  porIdExterno(id: string, idEmpresaExterna?: string): Promise<Factura> {
    return this.pedir('GET', `/v1/invoices/by-external/${encodeURIComponent(this.o.sistema)}/${encodeURIComponent(id)}`, { cab: idEmpresaExterna ? this.empresa(idEmpresaExterna) : {} });
  }

  anular(idEmpresaExterna: string, facturaId: string, motivo: number, comentario?: string): Promise<Factura> {
    return this.pedir('POST', `/v1/invoices/${facturaId}/void`, { cuerpo: { motivo, comentario }, cab: this.empresa(idEmpresaExterna) });
  }

  /** Pide a FacturaSIN que concilie las facturas pendientes de la empresa con el SIN. */
  conciliar(idEmpresaExterna: string): Promise<{ revisadas: number; cambiadas: number }> {
    return this.pedir('POST', '/v1/invoices/reconcile', { cab: this.empresa(idEmpresaExterna) });
  }

  pdf(idEmpresaExterna: string, facturaId: string, formato: 'a4' | 'rollo' = 'a4'): Promise<Buffer> {
    return this.pedir('GET', `/v1/invoices/${facturaId}/pdf?formato=${formato}`, { cab: this.empresa(idEmpresaExterna), crudo: true });
  }

  /** PNG del QR de la factura (el texto exacto va en `qrTexto`). */
  qr(idEmpresaExterna: string, facturaId: string): Promise<Buffer> {
    return this.pedir('GET', `/v1/invoices/${facturaId}/qr`, { cab: this.empresa(idEmpresaExterna), crudo: true });
  }

  xml(idEmpresaExterna: string, facturaId: string): Promise<Buffer> {
    return this.pedir('GET', `/v1/invoices/${facturaId}/xml`, { cab: this.empresa(idEmpresaExterna), crudo: true });
  }

  /** Suscribe TU webhook (solo recibirás los eventos de las facturas que TU sistema originó). El secreto se muestra una sola vez. */
  crearWebhook(idEmpresaExterna: string, url: string, eventos?: string[]): Promise<{ id: string; secreto: string }> {
    return this.pedir('POST', '/v1/webhooks', { cuerpo: { url, ...(eventos ? { eventos } : {}) }, cab: this.empresa(idEmpresaExterna) });
  }
}

/**
 * Obtiene (y cachea hasta 30 s antes de vencer) un access token por `client_credentials` de Kyros ID.
 * `clientSecret` lo entrega TU sistema desde su almacén de secretos; aquí no se guarda ni se imprime.
 */
export function tokenClientCredentials(o: { issuer: string; clientId: string; clientSecret: string; fetchImpl?: typeof fetch }): () => Promise<string> {
  const f = o.fetchImpl ?? fetch;
  let cache: { token: string; vence: number } | null = null;
  return async () => {
    if (cache && cache.vence - 30_000 > Date.now()) return cache.token;
    const res = await f(`${o.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: o.clientId, client_secret: o.clientSecret }),
    });
    if (!res.ok) throw new Error(`Kyros ID rechazó el client_credentials (HTTP ${res.status})`);
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    cache = { token: j.access_token, vence: Date.now() + (j.expires_in ?? 300) * 1000 };
    return cache.token;
  };
}

/**
 * Verifica la cabecera `X-FacturaSIN-Signature: t=<epoch>,v1=<hex>[,v1=<hex>]` sobre el cuerpo CRUDO (sin reparsear).
 * Acepta uno o varios secretos (rotación de 24 h), compara en tiempo constante y rechaza firmas de más de 5 minutos.
 */
export function verificarFirmaWebhook(secretos: string | string[], cabecera: string, cuerpoCrudo: string, ahora = Date.now()): boolean {
  const t = /t=(\d+)/.exec(cabecera);
  const firmas = [...cabecera.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]!);
  if (!t || !firmas.length) return false;
  const ts = Number(t[1]);
  if (Math.abs(ahora / 1000 - ts) > 300) return false;
  let ok = false;
  for (const secreto of ([] as string[]).concat(secretos)) {
    const esperado = Buffer.from(createHmac('sha256', secreto).update(`${ts}.${cuerpoCrudo}`).digest('hex'), 'hex');
    for (const f of firmas) {
      const b = Buffer.from(f, 'hex');
      if (b.length === esperado.length && timingSafeEqual(b, esperado)) ok = true;
    }
  }
  return ok;
}

/** Evento de webhook ya verificado. Deduplica por `X-FacturaSIN-Event-Id` (puede llegar más de una vez). */
export interface EventoWebhook {
  id: string;
  tipo: 'factura.pendiente' | 'factura.validada' | 'factura.observada' | 'factura.rechazada' | 'factura.anulada' | 'factura.contingencia' | string;
  empresaId: string;
  creadoEn: string;
  datos: { facturaId: string; cuf: string; numero: number; estado: EstadoFactura; idExterno?: string; ambientePruebas?: boolean };
}
