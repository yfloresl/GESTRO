/**
 * NÚCLEO DE INTEGRACIÓN CON FACTURASIN — versión única para los 7 sistemas Kyros (copia idéntica en cada repo).
 * Sin dependencias de framework: URL pública derivada, convenciones, normalización de empresa, webhook idempotente y mensajes legibles.
 * v2.0.0: el webhook y la credencial pasan por `enlace-facturasin.ts` (núcleo de FacturaSIN v1.0.0, copiado TAL CUAL); aquí NO hay segunda lógica de firma ni de enlace.
 * v2.1.0: auditoría de entregas del aviso (`vistaEntregas`), prueba de entrega en lenguaje simple (`mensajePruebaEntrega`), huella del secreto (`huellaSecreto`, `huellaCoincide`) y evaluación pura del aviso entrante (`evaluarEntrega`).
 * Cualquier cambio se hace aquí, se sube NUCLEO_INTEGRACION_VERSION y se copia a los demás sistemas.
 */
export const NUCLEO_INTEGRACION_VERSION = '2.1.0';

import { createHash } from 'node:crypto';
import { RUTA_WEBHOOK_FACTURASIN, verificarFirmaWebhook, type PasoPrueba as PasoFacturaSin } from './enlace-facturasin';

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
  asegurarWebhook(urlPublica: string, tenantId?: string, opciones?: { eventos?: string[]; rotarSecreto?: boolean }): Promise<{ suscripciones: Array<{ id: string; tenantId: string; url: string; estado: string }>; secreto: string | null }>;
}
export interface ResultadoWebhook { accion: 'sin_cambios' | 'creado' | 'actualizado' | 'secreto_renovado'; id: string; url: string; secreto?: string; eliminados: number }

/**
 * Deja UNA suscripción del sistema por empresa apuntando a `url` (`tenantId '*'`: todas, también tras un cambio de dominio) con el secreto de firma ÚNICO del sistema.
 * Si FacturaSIN no devuelve el secreto (ya existía) y aquí no hay uno guardado, lo renueva. Idempotente: repetirla no cambia nada.
 */
export async function asegurarWebhook(p: PuertoEnlaceWebhook, o: { url: string; secretoGuardado: boolean }): Promise<ResultadoWebhook> {
  let r = await p.asegurarWebhook(o.url, '*');
  let renovado = false;
  if (!r.secreto && !o.secretoGuardado) { r = await p.asegurarWebhook(o.url, '*', { rotarSecreto: true }); renovado = true; }
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
export const pasosDeFacturaSin = (pasos: PasoFacturaSin[]): PasoPrueba[] => pasos.map((p) => ({ clave: p.id, ok: p.estado !== 'error', detalle: `${p.titulo}: ${p.detalle}` }));

/** Un paso del diagnóstico «Conectar y probar». */
export interface PasoPrueba { clave: string; ok: boolean; detalle: string }
export const resumenPrueba = (pasos: PasoPrueba[]): { listo: boolean; resumen: string } => {
  const falla = pasos.find((p) => !p.ok);
  return falla ? { listo: false, resumen: `Falta: ${falla.detalle}` } : { listo: true, resumen: 'Todo listo: la conexión con FacturaSIN funciona de punta a punta.' };
};

/* ------------------------------ entregas del aviso (v2.1.0) ------------------------------ */

/** Huella corta del secreto de firma (la misma que publica FacturaSIN en `secretoHuella`): 8 hex de sha256. Nunca revela el secreto. */
export const huellaSecreto = (secreto: string): string => createHash('sha256').update(secreto).digest('hex').slice(0, 8);
/** `true` si lo que FacturaSIN firma (huella remota) es el secreto guardado aquí. Sin secreto guardado o sin huella remota: no coincide. */
export const huellaCoincide = (huellaRemota: string | null | undefined, secretoLocal: string | null | undefined): boolean => !!huellaRemota && !!secretoLocal && huellaRemota === huellaSecreto(secretoLocal);

/** Entrega tal como la devuelve `GET /v1/integraciones/webhooks/entregas`. */
export interface EntregaFs { id: string; eventoId: string; tipo: string; estado: string; intentos: number; ultimoIntentoEn: string | null; ultimoCodigoHttp: number | null; ultimoError: string | null; facturaId: string | null; numero: number | null; estadoFactura: string | null; idExterno: string | null }
export interface EntregaVista { id: string; tipo: string; facturaId: string | null; numero: number | null; estadoFactura: string | null; estado: string; intentos: number; ultimoIntentoEn: string | null; http: number | null; error: string | null; registradaPorElSistema: boolean }

/** Las `n` últimas entregas para el panel; `idsRegistrados` = ids de evento que este sistema SÍ recibió y aplicó (para mostrar «el sistema la registró»). */
export function vistaEntregas(entregas: EntregaFs[], idsRegistrados: ReadonlySet<string>, n = 5): EntregaVista[] {
  return entregas.slice(0, n).map((e) => ({
    id: e.id, tipo: e.tipo, facturaId: e.facturaId, numero: e.numero, estadoFactura: e.estadoFactura, estado: e.estado, intentos: e.intentos, ultimoIntentoEn: e.ultimoIntentoEn,
    http: e.ultimoCodigoHttp, error: e.ultimoError, registradaPorElSistema: idsRegistrados.has(e.eventoId),
  }));
}

/** Resultado de «Probar entrega» (`POST /v1/integraciones/webhooks/probar`) en lenguaje simple. */
export function mensajePruebaEntrega(resultados: Array<{ ok: boolean; codigoHttp: number | null; error?: string | null; secretoHuella?: string }>, secretoLocal?: string | null): { ok: boolean; mensaje: string } {
  if (!resultados.length) return { ok: false, mensaje: 'FacturaSIN no tiene un aviso suscrito para este sistema. Pulsa «Verificar»: se suscribe solo.' };
  const mala = resultados.find((r) => !r.ok);
  if (mala) {
    const h = mala.codigoHttp;
    if (h === 401 || h === 403) return { ok: false, mensaje: 'El sistema recibió el aviso de prueba pero rechazó la firma: el secreto de aquí y el de FacturaSIN no coinciden. Pulsa «Verificar»: se vuelve a sincronizar solo, una vez.' };
    if (h === 404 || h === 405) return { ok: false, mensaje: `FacturaSIN no encontró la ruta del aviso en este sistema (HTTP ${h}). Si el sistema se actualizó hace poco, espera unos minutos y reintenta; el aviso se vuelve a suscribir solo.` };
    if (h !== null && h >= 500) return { ok: false, mensaje: `El sistema respondió con un error interno (HTTP ${h}). Avisa a soporte de Kyros-Tech si se repite.` };
    return { ok: false, mensaje: `FacturaSIN no pudo llegar al sistema${mala.error ? ` (${mala.error})` : ''}. Revisa que la dirección pública sea accesible desde internet.` };
  }
  if (secretoLocal !== undefined && resultados[0]?.secretoHuella && !huellaCoincide(resultados[0].secretoHuella, secretoLocal)) return { ok: false, mensaje: 'La entrega llegó, pero el secreto guardado aquí no es el que firma FacturaSIN. Pulsa «Verificar»: se vuelve a sincronizar solo, una vez.' };
  return { ok: true, mensaje: 'Entrega de prueba correcta: FacturaSIN llegó al sistema y la firma es válida.' };
}

/** Evalúa un aviso entrante SIN tocar la base: firma HMAC sobre el cuerpo crudo (uno o dos secretos) y forma mínima. `evento` solo viene si la firma es válida. */
export function evaluarEntrega(secretos: string[], cabeceraFirma: string, crudo: string, ahoraMs = Date.now()): { http: 200 | 400 | 401; resultado: 'ok' | 'firma_invalida' | 'cuerpo_invalido'; evento?: { id: string; tipo: string; datos: Record<string, any> } } { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!secretos.length || !crudo || !verificarFirmaWebhook(secretos, cabeceraFirma, crudo, ahoraMs)) return { http: 401, resultado: 'firma_invalida' };
  try {
    const ev = JSON.parse(crudo) as { id?: string; tipo?: string; datos?: Record<string, unknown> };
    if (!ev?.id || !ev.tipo || !ev.datos) return { http: 400, resultado: 'cuerpo_invalido' };
    return { http: 200, resultado: 'ok', evento: ev as { id: string; tipo: string; datos: Record<string, any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch { return { http: 400, resultado: 'cuerpo_invalido' }; }
}
