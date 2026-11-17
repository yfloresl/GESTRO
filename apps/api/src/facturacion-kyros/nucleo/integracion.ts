/**
 * NÚCLEO DE INTEGRACIÓN CON FACTURASIN — versión única para los 7 sistemas Kyros (copia idéntica en cada repo).
 * Sin dependencias de framework: URL pública derivada, convenciones, normalización de empresa, webhook idempotente y mensajes legibles.
 * v2.0.0: el webhook y la credencial pasan por `enlace-facturasin.ts` (núcleo de FacturaSIN v1.0.0, copiado TAL CUAL); aquí NO hay segunda lógica de firma ni de enlace.
 * v2.3.0: `facturacionHabilitada` (estándar «pago + interruptor» de la facturación del cliente).
 * v2.4.0: `probarConFacturaDePrueba` (en ambiente simulado «Conectar y probar» emite una factura de prueba) y texto simple en el paso de factura de prueba.
 * Cualquier cambio se hace aquí, se sube NUCLEO_INTEGRACION_VERSION y se copia a los demás sistemas.
 */
export const NUCLEO_INTEGRACION_VERSION = '2.4.0';

import { createHash } from 'node:crypto';
import { ErrorEnlace, RUTA_WEBHOOK_FACTURASIN, type PasoPrueba as PasoFacturaSin } from './enlace-facturasin';

/** Ruta pública ESTÁNDAR (la define FacturaSIN) donde cada sistema recibe los avisos de TODAS sus empresas. */
export const RUTA_WEBHOOK = RUTA_WEBHOOK_FACTURASIN;

/* ------------------------------ URL pública ------------------------------ */

export interface SolicitudLike { headers: Record<string, string | string[] | undefined>; protocol?: string; hostname?: string }
export type ResultadoUrl = { ok: true; base: string; origen: 'x-forwarded' | 'host' } | { ok: false; motivo: string };

const primero = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '').split(',')[0]!.trim();

/** `true` si el host no es alcanzable desde internet (localhost, nombres internos, IP privada/loopback/enlace local, sin punto). */
export function hostNoPublico(hostConPuerto: string): boolean {
  let h = hostConPuerto.trim().toLowerCase();
  if (!h) return true;
  if (h.startsWith('[')) return true; // IPv6 literal: nunca es un dominio público de producto
  h = h.replace(/:\d+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.test') || h.endsWith('.invalid')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 literal: no es un dominio de producto (ni privado ni público se acepta por https de dominio)
  if (!h.includes('.')) return true;
  return !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h);
}

/**
 * Dirección pública con la que se llegó al sistema: X-Forwarded-Proto/X-Forwarded-Host (o el Host propio). Exige https y un dominio público;
 * en desarrollo acepta http y localhost. Nunca lee variables de entorno.
 */
export function urlPublica(req: SolicitudLike, o: { desarrollo?: boolean } = {}): ResultadoUrl {
  const h = req.headers;
  const fwdHost = primero(h['x-forwarded-host']);
  const host = fwdHost || primero(h['host']) || (req.hostname ?? '');
  const origen = fwdHost ? 'x-forwarded' as const : 'host' as const;
  const proto = (primero(h['x-forwarded-proto']) || req.protocol || '').toLowerCase();
  if (!host) return { ok: false, motivo: 'La petición no trae el dominio con el que se llegó al sistema.' };
  if (/[\s/@\\?#]/.test(host)) return { ok: false, motivo: 'El dominio de la petición no es válido.' };
  if (!o.desarrollo) {
    if (proto !== 'https') return { ok: false, motivo: 'Se llegó al sistema por una dirección sin https; FacturaSIN solo avisa a direcciones https públicas.' };
    if (hostNoPublico(host)) return { ok: false, motivo: 'Se llegó al sistema por una dirección local o privada; FacturaSIN no puede avisarle ahí.' };
  } else if (proto !== 'https' && proto !== 'http') return { ok: false, motivo: 'Protocolo no válido.' };
  return { ok: true, base: `${proto}://${host.toLowerCase()}`, origen };
}

/** `true` si `url` es exactamente el aviso de estados de ESTE sistema bajo la base pública dada (evita desviar el webhook a otro dominio). */
export const urlWebhookDe = (base: string): string => `${base.replace(/\/+$/, '')}${RUTA_WEBHOOK}`;

/**
 * Última URL pública conocida. Primera vez: se acepta de inmediato. Cambio de dominio: se acepta si la petición es de un administrador
 * de la plataforma o si el nuevo dominio se vio en `UMBRAL` peticiones distintas (una petición suelta con otra cabecera no desvía nada).
 */
export class RegistroUrlPublica {
  static readonly UMBRAL = 3;
  private vistas = new Map<string, number>();
  constructor(private actual: string | null = null) {}
  get base(): string | null { return this.actual; }
  /** Devuelve `{cambio:true, base}` si hay que persistir una URL nueva. */
  observar(base: string, esAdmin = false): { cambio: boolean; base: string } {
    if (base === this.actual) { this.vistas.clear(); return { cambio: false, base }; }
    const n = (this.vistas.get(base) ?? 0) + 1;
    if (this.actual === null || esAdmin || n >= RegistroUrlPublica.UMBRAL) { this.actual = base; this.vistas.clear(); return { cambio: true, base }; }
    if (this.vistas.size > 20) this.vistas.clear();
    this.vistas.set(base, n);
    return { cambio: false, base: this.actual };
  }
  fijar(base: string | null): void { this.actual = base; this.vistas.clear(); }
}

/* ------------------------------ convenciones ------------------------------ */

export const ENTORNO_FACTURASIN_URL = 'https://facturasin.kyros-tech.com/api';
/** Códigos fiscales provisionales del catálogo SIMULADO de FacturaSIN. NO CONFIRMADO: el contador los confirma con el catálogo real. */
export const CODIGOS_PROVISIONALES = { codigoProductoSin: '83141', actividadEconomica: '620100', unidadMedida: 58 } as const;

/** Todo lo que antes se tecleaba, por convención a partir del nombre del sistema (`vet`, `axion`, `glucora`, `hub`, `medyx`, `dental`, `gestro`). */
export function convencion(sistema: string) {
  return { clientId: `${sistema}-service`, empresa: 'kyros-tech', empresaExterna: `${sistema}:kyros-tech`, url: ENTORNO_FACTURASIN_URL, ...CODIGOS_PROVISIONALES, sector: 1, sucursal: 0, puntoVenta: 0 };
}

/** GL-040: el id de empresa se guarda SIN el prefijo del sistema; si el valor ya lo trae (`glucora:kyros-tech`, repetido o no) no se duplica. */
export function normalizarEmpresa(sistema: string, valor: string | null | undefined): string {
  let v = String(valor ?? '').trim().toLowerCase();
  const pref = `${sistema.toLowerCase()}:`;
  while (v.startsWith(pref)) v = v.slice(pref.length);
  v = v.replace(/^:+/, '');
  return v || 'kyros-tech';
}
export const empresaExterna = (sistema: string, valor: string | null | undefined): string => `${sistema}:${normalizarEmpresa(sistema, valor)}`;

/* ------------------------------ webhook idempotente (sobre el núcleo de enlace de FacturaSIN) ------------------------------ */

/** Lo único que se usa del núcleo de enlace: `EnlaceFacturaSin` lo cumple tal cual. */
export interface PuertoEnlaceWebhook {
  /** Opcional: huella del secreto de firma que FacturaSIN tiene para este sistema (para detectar un secreto local distinto). */
  huellaRemota?(): Promise<string | null>;
  asegurarWebhook(urlPublica: string, tenantId?: string, opciones?: { eventos?: string[]; rotarSecreto?: boolean }): Promise<{ suscripciones: Array<{ id: string; tenantId: string; url: string; estado: string }>; secreto: string | null }>;
}
export interface ResultadoWebhook { accion: 'sin_cambios' | 'creado' | 'actualizado' | 'secreto_renovado'; id: string; url: string; secreto?: string; eliminados: number }

/**
 * Deja UNA suscripción del sistema por empresa apuntando a `url` (`tenantId '*'`: todas, también tras un cambio de dominio) con el secreto de firma ÚNICO del sistema.
 * Si FacturaSIN no devuelve el secreto (ya existía) y aquí no hay uno guardado, lo renueva. Idempotente: repetirla no cambia nada.
 */
export async function asegurarWebhook(p: PuertoEnlaceWebhook, o: { url: string; secretoGuardado: boolean; huellaLocal?: string | null }): Promise<ResultadoWebhook> {
  let r = await p.asegurarWebhook(o.url, '*');
  let renovado = false;
  if (!r.secreto && !o.secretoGuardado) { r = await p.asegurarWebhook(o.url, '*', { rotarSecreto: true }); renovado = true; }
  // El secreto de firma guardado aquí debe ser el que FacturaSIN usa para firmar. Si la huella no coincide se re-sincroniza UNA vez (nunca en cada pulsación).
  else if (!r.secreto && o.secretoGuardado && o.huellaLocal && p.huellaRemota) {
    const remota = await p.huellaRemota().catch(() => null);
    if (remota && remota !== o.huellaLocal) { r = await p.asegurarWebhook(o.url, '*', { rotarSecreto: true }); renovado = true; }
  }
  const s = r.suscripciones;
  const creadas = s.some((x) => x.estado === 'creada'); const cambiadas = s.some((x) => x.estado === 'actualizada');
  const accion: ResultadoWebhook['accion'] = renovado ? 'secreto_renovado' : creadas ? 'creado' : cambiadas ? 'actualizado' : 'sin_cambios';
  return { accion, id: s[0]?.id ?? '', url: o.url, ...(r.secreto ? { secreto: r.secreto } : {}), eliminados: 0 };
}

/* ------------------------------ mensajes ------------------------------ */

/** Traduce un error de integración a «qué pasó» + «qué hace el sistema solo». Nunca devuelve «HTTP 400» crudo ni pide ir a Keycloak. */
export function mensajeIntegracion(e: unknown): { codigo: string; mensaje: string } {
  const x = e as { codigo?: string; estado?: number; message?: string } | null;
  const codigo = String(x?.codigo ?? 'ERROR'); const estado = Number(x?.estado ?? 0);
  if (codigo === 'EMPRESA_NO_ENCONTRADA') return { codigo, mensaje: 'La empresa de Kyros-Tech todavía no existe en FacturaSIN. El sistema la pide al enlazarse y reintenta en la próxima conciliación.' };
  if (codigo === 'REQUIERE_ELEGIR_RUBRO') return { codigo, mensaje: 'Falta elegir el rubro de la empresa una sola vez (actividad y producto del SIN). Elígelo en el selector y vuelve a facturar.' };
  if (codigo === 'NIT_EN_USO') return { codigo, mensaje: 'Ese NIT ya pertenece a otra empresa enlazada en FacturaSIN. Revisa el NIT ingresado; si es correcto, avisa a soporte de Kyros-Tech.' };
  if (codigo === 'SIN_ARRANQUE' || codigo === 'SISTEMA_NO_REGISTRADO') return { codigo, mensaje: 'Este sistema todavía no puede enlazarse solo con FacturaSIN (falta su arranque inicial). Soporte de Kyros-Tech lo completa una sola vez; no hay que tocar Keycloak.' };
  if (codigo === 'NO_CONFIGURADO') return { codigo, mensaje: 'Falta enlazar el sistema con FacturaSIN. Pulsa «Conectar y probar»; el sistema pide la credencial de servicio solo.' };
  if (estado === 401 || estado === 403 || /token|invalid_client|unauthorized/i.test(String(x?.message))) return { codigo, mensaje: 'FacturaSIN no reconoció la credencial de servicio de este sistema. El sistema la renueva solo con el enlace automático; si persiste, avisa a soporte de Kyros-Tech.' };
  if (estado === 0 || estado >= 500 || /fetch failed|timeout|abort|ECONN|ENOTFOUND/i.test(String(x?.message))) return { codigo, mensaje: 'No se pudo hablar con FacturaSIN en este momento. No se pierde nada: el sistema reintenta solo en la próxima conciliación.' };
  if (estado === 422 || estado === 400) return { codigo, mensaje: 'FacturaSIN rechazó los datos enviados. Corrige el dato indicado en la factura y reintenta; la configuración de la conexión no es la causa.' };
  return { codigo, mensaje: 'La integración con FacturaSIN tuvo un problema. El sistema reintenta solo; si persiste, avisa a soporte de Kyros-Tech.' };
}

/** Pasos de «probar integración» de FacturaSIN (`ok|error|aviso|omitido`) al formato del panel. «error» es el único que bloquea. */
/** El paso de «factura de prueba» no la emitió y lo dice con el parámetro técnico: se explica en lenguaje simple (GL-041). */
const detalleSimple = (p: PasoFacturaSin): string => (/emitirPrueba/i.test(p.detalle) ? 'todavía no se emitió una factura de prueba. En ambiente SIMULADO «Conectar y probar» la emite sola; en el real solo si se pide.' : p.detalle);
export const pasosDeFacturaSin = (pasos: PasoFacturaSin[]): PasoPrueba[] => pasos.map((p) => ({ clave: p.id, ok: p.estado !== 'error', detalle: `${p.titulo}: ${detalleSimple(p)}` }));

/** ¿FacturaSIN opera en ambiente SIMULADO? (paso «ambiente» de la prueba legible). */
export const esAmbienteSimulado = (pasos: PasoFacturaSin[]): boolean => pasos.some((p) => /ambiente/i.test(`${p.id} ${p.titulo}`) && /simulad/i.test(p.detalle));
const esPasoFacturaPrueba = (p: PasoFacturaSin): boolean => /factura.*prueba|prueba.*factura|emision_prueba/i.test(`${p.id} ${p.titulo}`);
/**
 * «Conectar y probar» de la empresa de Kyros-Tech: en ambiente SIMULADO emite por defecto una factura de prueba (sin validez fiscal) para probar la emisión de punta a punta;
 * en ambiente real no emite nada salvo que se pida (`emitirPrueba: true`). `emitirPrueba: false` nunca emite.
 */
export async function probarConFacturaDePrueba(enlace: { probar(tenantId: string, emitirPrueba?: boolean): Promise<{ pasos: PasoFacturaSin[] }> }, tenantId: string, emitirPrueba?: boolean): Promise<{ pasos: PasoFacturaSin[] }> {
  let r = await enlace.probar(tenantId, emitirPrueba === true);
  if (emitirPrueba === undefined && esAmbienteSimulado(r.pasos) && !r.pasos.some((p) => esPasoFacturaPrueba(p) && p.estado === 'ok')) r = await enlace.probar(tenantId, true);
  return r;
}

/** Un paso del diagnóstico «Conectar y probar». */
export interface PasoPrueba { clave: string; ok: boolean; detalle: string }
export const resumenPrueba = (pasos: PasoPrueba[]): { listo: boolean; resumen: string } => {
  const falla = pasos.find((p) => !p.ok);
  return falla ? { listo: false, resumen: `Falta: ${falla.detalle}` } : { listo: true, resumen: 'Todo listo: la conexión con FacturaSIN funciona de punta a punta.' };
};

/* ------------------------------ entregas del aviso: auditoría, huella del secreto y registro local ------------------------------ */

/** Huella corta del secreto de firma (8 primeros hex de su SHA-256): permite comparar sin mostrar ni enviar el secreto. Igual que la de FacturaSIN. */
export const huellaSecreto = (secreto: string): string => createHash('sha256').update(secreto).digest('hex').slice(0, 8);
export const huellaCoincide = (remota: string | null | undefined, secreto: string | null | undefined): boolean => !!remota && !!secreto && remota === huellaSecreto(secreto);

/** Una entrega del aviso tal como la audita FacturaSIN (`GET /v1/integraciones/webhooks/entregas`). */
export interface EntregaFs {
  id: string; facturaId: string | null; tipo: string; estado: string; intentos: number; ultimoCodigoHttp: number | null; ultimoIntentoEn: string | null;
  proximoIntento?: string | null; entregadaEn?: string | null; numero?: number | null; estadoFactura?: string | null; idExterno?: string | null;
}
/** Lo que registra el endpoint receptor del propio sistema por cada petición que le llega. */
export interface EntregaLocal { fecha: string; evento: string; eventoId: string; facturaId: string | null; resultado: string; firmaValida: boolean; /** Lo que tardó el receptor en responder (registrar y aplicar), en ms. */ ms?: number }
export interface RegistroEntregas { total: number; firmaInvalida: number; ultimas: EntregaLocal[] }

/** Lee el registro guardado (texto JSON u objeto: algunas bases/ORM devuelven uno u otro). Nunca lanza. */
export function leerRegistroEntregas(v: unknown): RegistroEntregas {
  let x: unknown = v;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = null; } }
  const o = x as Partial<RegistroEntregas> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.ultimas)) return { total: 0, firmaInvalida: 0, ultimas: [] };
  return { total: Number(o.total) || 0, firmaInvalida: Number(o.firmaInvalida) || 0, ultimas: o.ultimas.filter((e) => e && typeof e === 'object').slice(0, 20) as EntregaLocal[] };
}
/** Agrega una entrega al registro (las más recientes primero, máximo `max`). Puro. */
export function registrarEntregaLocal(reg: RegistroEntregas, e: EntregaLocal, max = 20): RegistroEntregas {
  return { total: reg.total + 1, firmaInvalida: reg.firmaInvalida + (e.firmaValida ? 0 : 1), ultimas: [e, ...reg.ultimas].slice(0, max) };
}
/** Datos del evento para el registro, sacados SIN confiar en el cuerpo (si no es JSON queda vacío). */
export function datosDeEvento(crudo: string, eventoIdCabecera?: string | null): { evento: string; eventoId: string; facturaId: string | null } {
  try {
    const j = JSON.parse(crudo) as { id?: unknown; tipo?: unknown; datos?: { facturaId?: unknown } };
    return { evento: String(j.tipo ?? '—').slice(0, 60), eventoId: String(eventoIdCabecera || j.id || '—').slice(0, 80), facturaId: j.datos?.facturaId ? String(j.datos.facturaId).slice(0, 80) : null };
  } catch { return { evento: '—', eventoId: String(eventoIdCabecera || '—').slice(0, 80), facturaId: null }; }
}
/** Resultados con los que el sistema DEJÓ registrada la entrega (firma válida y cuerpo entendido). */
const REGISTRADA = new Set(['aplicado', 'duplicado', 'sin_cambio', 'factura_desconocida']);
/** Cruza lo que FacturaSIN dice que entregó con lo que este sistema registró: «registrada» = hubo una petición con firma válida de esa factura y evento. */
export function cruzarEntregas(remotas: EntregaFs[], locales: EntregaLocal[]): Array<EntregaFs & { registrada: boolean }> {
  return remotas.map((r) => ({ ...r, registrada: locales.some((l) => l.firmaValida && REGISTRADA.has(l.resultado) && !!r.facturaId && l.facturaId === r.facturaId && l.evento === r.tipo) }));
}

/** Resultado de «Probar entrega» (`POST /v1/integraciones/webhooks/probar`) en lenguaje simple. */
export interface PruebaEntrega { ok: boolean; codigoHttp: number | null; ms?: number; url?: string; error?: string | null; secretoHuella?: string | null }
/**
 * `POST /v1/integraciones/webhooks/probar` responde `{ empresa, resultados: [{ webhookId, url, ok, codigoHttp, ms, error, secretoHuella }] }` (uno por suscripción).
 * Se queda con el primer fallo (o, si todos van bien, con el primero). Acepta también un resultado suelto. Sin resultados es un fallo explícito, no «sin respuesta» mudo.
 */
export function resumirPrueba(r: unknown): PruebaEntrega {
  const x = r as { resultados?: PruebaEntrega[] } & Partial<PruebaEntrega> | null;
  const lista: PruebaEntrega[] = Array.isArray(x?.resultados) ? x!.resultados! : x && typeof x.ok === 'boolean' ? [x as PruebaEntrega] : [];
  if (!lista.length) return { ok: false, codigoHttp: null, error: 'FacturaSIN no devolvió el resultado de la prueba' };
  return lista.find((e) => !e.ok) ?? lista[0]!;
}

/** Latencia del receptor a partir de lo registrado (para detectar un receptor lento que haría vencer el tiempo de espera de FacturaSIN, 10 s). */
export function latenciaReceptor(locales: EntregaLocal[]): { ultimaMs: number | null; maxMs: number | null; promedioMs: number | null } {
  const v = locales.map((e) => e.ms).filter((m): m is number => typeof m === 'number');
  return { ultimaMs: v[0] ?? null, maxMs: v.length ? Math.max(...v) : null, promedioMs: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null };
}

/**
 * Vista COMPLETA de una factura tal como la devolvió FacturaSIN (webhook `datos.factura` + `datos.enlaces`, o `GET /invoices/by-external/…`), lista para guardar sin alterar ningún dato fiscal.
 * Devuelve null si no hay nada que guardar. `fechaEmision` solo si es una fecha válida.
 */
export function vistaParaGuardar(v: unknown, extra: { enlaces?: unknown; estado?: string | null; cuf?: string | null; numero?: number | null } = {}): { respuesta: Record<string, unknown>; fechaEmision: string | null } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  if (!Object.keys(r).length) return null;
  if (extra.enlaces && typeof extra.enlaces === 'object' && !r.enlaces) r.enlaces = extra.enlaces;
  if (extra.estado && !r.estado) r.estado = extra.estado;
  if (extra.cuf && !r.cuf) r.cuf = extra.cuf;
  if (extra.numero != null && r.numero == null) r.numero = extra.numero;
  const f = typeof r.fechaEmision === 'string' && !Number.isNaN(Date.parse(r.fechaEmision)) ? new Date(r.fechaEmision).toISOString() : null;
  return { respuesta: r, fechaEmision: f };
}

export function describirPruebaEntrega(r: PruebaEntrega): { ok: boolean; mensaje: string } {
  let ruta = r.url ?? '';
  try { ruta = new URL(String(r.url)).pathname; } catch { /* queda la URL tal cual */ }
  if (r.ok) return { ok: true, mensaje: `FacturaSIN pudo avisarte (HTTP ${r.codigoHttp ?? 200}${r.ms !== undefined ? `, ${r.ms} ms` : ''}).` };
  if (r.codigoHttp === null || r.codigoHttp === undefined) return { ok: false, mensaje: `FacturaSIN no pudo llegar a ${ruta || 'tu dirección'}: ${r.error ?? 'sin respuesta'}. El sistema reintenta solo.` };
  const pista = r.codigoHttp === 401 ? 'la firma no coincide (el sistema re-sincroniza el secreto solo)' : r.codigoHttp === 404 ? 'la ruta del aviso no existe' : r.codigoHttp === 413 ? 'el aviso es más grande de lo que acepta el servidor' : r.codigoHttp >= 500 ? 'el sistema falló al recibirlo' : 'el sistema lo rechazó';
  return { ok: false, mensaje: `FacturaSIN no pudo llegar a ${ruta}: HTTP ${r.codigoHttp} (${pista}).` };
}

/** Consultas de auditoría del aviso con la credencial propia (re-enlaza una sola vez ante 401). Sin dependencias del sistema. */
export class AvisosFacturaSin {
  constructor(private readonly enlace: { credencial(): Promise<string>; enlazar(): Promise<string> }, private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async http<T>(metodo: string, ruta: string, cuerpo?: unknown, reintento = false): Promise<T> {
    const res = await this.fetchImpl(this.baseUrl.replace(/\/$/, '') + ruta, { method: metodo, headers: { authorization: `Bearer ${await this.enlace.credencial()}`, ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}) });
    const texto = await res.text(); let json: unknown = null; try { json = JSON.parse(texto); } catch { /* no es JSON */ }
    if (res.ok) return json as T;
    if (res.status === 401 && !reintento) { await this.enlace.enlazar(); return this.http<T>(metodo, ruta, cuerpo, true); }
    const j = json as { codigo?: string; mensaje?: string } | null;
    throw new ErrorEnlace(res.status, j?.codigo ?? 'ERROR_HTTP', j?.mensaje ?? (texto.slice(0, 200) || `HTTP ${res.status}`));
  }
  entregas(limite = 5): Promise<EntregaFs[]> { return this.http('GET', `/v1/integraciones/webhooks/entregas?limite=${Math.max(1, Math.min(50, limite))}`); }
  suscripciones(): Promise<Array<{ id: string; tenantId: string; url: string; activo: boolean; secretoHuella?: string | null }>> { return this.http('GET', '/v1/integraciones/webhooks'); }
  async probarEntrega(tenantId = 'kyros-tech'): Promise<PruebaEntrega> { return resumirPrueba(await this.http('POST', '/v1/integraciones/webhooks/probar', { tenantId })); }
  /** Pide a FacturaSIN que vuelva a enviar UNA entrega concreta (`POST …/webhooks/entregas/{id}/reintentar`). */
  reintentarEntrega(id: string): Promise<unknown> { return this.http('POST', `/v1/integraciones/webhooks/entregas/${encodeURIComponent(id)}/reintentar`, {}); }
  /** Huella del secreto de firma que FacturaSIN usa para ESTE sistema (la de la suscripción de `tenantId` o, si no hay, la primera). */
  async huellaRemota(tenantId = 'kyros-tech'): Promise<string | null> {
    const l = await this.suscripciones();
    return (l.find((x) => x.tenantId === tenantId) ?? l[0])?.secretoHuella ?? null;
  }
}
/** Puerto de webhook que además sabe comparar la huella del secreto (lo usa `asegurarWebhook`). */
export const puertoConHuella = (enlace: PuertoEnlaceWebhook, avisos: Pick<AvisosFacturaSin, 'huellaRemota'>): PuertoEnlaceWebhook => ({
  asegurarWebhook: (u, t, o) => enlace.asegurarWebhook(u, t, o), huellaRemota: () => avisos.huellaRemota(),
});

/* ------------------------------ habilitación de la facturación del cliente: «pago + interruptor» (v2.3.0) ------------------------------ */

/** Por qué la facturación de un cliente está (o no) habilitada. */
export type MotivoFacturacion = 'habilitada_por_admin' | 'desactivada_por_admin' | 'por_plan' | 'no_incluida';
/** Lo único que hace falta saber de un cliente (consultorio/odontólogo/médico/restaurante/clínica) para decidirlo. */
export interface ClienteFacturable {
  /** Interruptor del SuperAdmin de la plataforma: `true` = encendido, `false` = apagado, `null`/`undefined` = sin override (decide el plan). */
  override?: boolean | null;
  /** ¿Tiene un plan de PAGO vigente? (prueba gratuita, demostración o plan vencido/en mora = `false`). */
  planDePagoVigente: boolean;
}
export interface HabilitacionFacturacion { habilitada: boolean; motivo: MotivoFacturacion; origen: 'superadmin' | 'plan' | 'ninguno'; etiqueta: string; mensaje: string | null }

const ETIQUETA_FACTURACION: Record<MotivoFacturacion, string> = {
  habilitada_por_admin: 'Habilitada por el administrador',
  desactivada_por_admin: 'Desactivada por el administrador',
  por_plan: 'Por plan',
  no_incluida: 'No incluida',
};

/**
 * ESTÁNDAR ÚNICO «pago + interruptor» (decisión del dueño, 17/11/2026), idéntico en los 7 sistemas. Orden: 1) override explícito del SuperAdmin de la plataforma
 * (encendido o apagado); 2) sin override, plan de pago vigente = habilitada; 3) en otro caso «No incluida en tu plan» + cómo pedirla.
 * Alimenta `PUT /v1/integraciones/habilitacion/{tenantId}` de FacturaSIN y el interruptor por cliente del panel del SuperAdmin.
 */
export function facturacionHabilitada(c: ClienteFacturable): HabilitacionFacturacion {
  const hecho = (habilitada: boolean, motivo: MotivoFacturacion, origen: HabilitacionFacturacion['origen'], mensaje: string | null): HabilitacionFacturacion => ({ habilitada, motivo, origen, etiqueta: ETIQUETA_FACTURACION[motivo], mensaje });
  if (c.override === true) return hecho(true, 'habilitada_por_admin', 'superadmin', null);
  if (c.override === false) return hecho(false, 'desactivada_por_admin', 'superadmin', 'La facturación electrónica fue desactivada para tu cuenta por el administrador de la plataforma. Escribe a administracion@kyros-tech.com para reactivarla.');
  if (c.planDePagoVigente) return hecho(true, 'por_plan', 'plan', null);
  return hecho(false, 'no_incluida', 'ninguno', 'No incluida en tu plan. Se activa sola con un plan de pago vigente; también puedes pedirla a administracion@kyros-tech.com.');
}
