/**
 * Orquestación reutilizable de «cobro validado -> factura» con FacturaSIN (Flujo 1: Kyros-Tech factura a su cliente).
 * Sin Nest ni base de datos: el sistema que lo use aporta un `AlmacenFacturas` (puerto) y un cliente de FacturaSIN.
 *
 * Garantías:
 *  - Idempotente: la clave es `<sistema>:suscripcion-<idPago>` (más `:r<n>` solo tras un rechazo del SIN). Reintentar nunca duplica.
 *  - Nunca lanza por fallos de FacturaSIN: devuelve un resultado y deja el estado guardado (alerta, no bloqueo; la activación no depende del SIN).
 *  - Se factura lo cobrado; IVA 13 % por dentro en centavos enteros.
 */
import { comoNumero, deCentavos, desglosar, type Centavos } from './calculo';
import { CODIGO_TIPO_DOC, COMPRADOR_CONSUMIDOR_FINAL, validarDatosFiscales, type DatosFiscales } from './fiscal';
import { FacturaSinError, type Factura, type EstadoFactura } from './facturasin-client';

export type EstadoLocal = 'pendiente' | 'emitiendo' | 'en_proceso' | 'emitida' | 'observada' | 'rechazada' | 'anulada';

export interface PagoFacturable {
  pagoId: string;
  /** Texto del plan, p. ej. «Plan Pro». */
  plan: string | null;
  meses: number;
  mesesDeRegalo: number;
  /** Lo COBRADO, en centavos de Bs. */
  montoCent: Centavos;
  desde: string | null;
  hasta: string | null;
  precioUsd?: string | null;
  tco?: { usdBob: string; fecha: string } | null;
  /** Datos fiscales cargados por el cliente (pueden faltar). */
  fiscales: { tipo?: string | null; numero?: string | null; complemento?: string | null; razonSocial?: string | null; correo?: string | null };
}

export interface FilaFactura {
  id: string; pagoId: string; estado: EstadoLocal; intentos: number; claveIdempotencia: string; facturasinId: string | null;
}
export interface DatosIntento {
  clave: string; comprador: { tipo: string; numero: string; complemento: string | null; razonSocial: string; correo: string | null };
  consumidorFinal: boolean; descripcion: string; totalCent: Centavos; ivaCent: Centavos;
}
export interface ResultadoGuardado {
  estado: EstadoLocal;
  facturasinId?: string | null; cuf?: string | null; numero?: number | null; qrTexto?: string | null; ambientePruebas?: boolean; avisoFiscal?: string | null; ivaFsCent?: Centavos | null;
  errorCodigo?: string | null; error?: string | null; reintentable?: boolean;
}
export interface AlmacenFacturas {
  obtener(pagoId: string): Promise<FilaFactura | null>;
  /** Crea o actualiza la fila (estado `emitiendo`, intentos+1). Si `claveNueva` ya existe en otra fila, es un error del almacén. */
  iniciarIntento(pago: PagoFacturable, d: DatosIntento): Promise<FilaFactura>;
  guardarResultado(pagoId: string, r: ResultadoGuardado): Promise<void>;
}
export interface ClienteEmision { emitir(idEmpresaExterna: string, d: any, clave?: string): Promise<Factura> }

export interface ConfigEmision {
  sistema: string;
  /** Id de la empresa emisora en TU sistema (`<sistema>:<id>` ya enlazado en FacturaSIN), p. ej. `kyros-tech`. */
  empresa: string;
  sector: number; sucursal: number; puntoVenta: number;
  /** Catálogo del SIN: 7 = transferencia bancaria (confirmar con el contador). */
  metodoPago: number;
  codigoProducto: string;
}

export type Resultado =
  | { ok: true; estado: EstadoLocal; yaExistia: boolean; factura?: Factura }
  | { ok: false; estado: EstadoLocal; codigo: string; mensaje: string; reintentable: boolean };

/** Estado de FacturaSIN -> estado local. */
export function estadoLocalDe(e: EstadoFactura | string): EstadoLocal {
  switch (e) {
    case 'validada': return 'emitida';
    case 'anulada': return 'anulada';
    case 'rechazada': return 'rechazada';
    case 'observada': return 'observada';
    default: return 'en_proceso'; // pendiente, contingencia
  }
}

/** Orden de avance para aplicar eventos fuera de orden sin retroceder (anulada manda; rechazada se corrige reemitiendo, no por evento viejo). */
export function aceptaTransicion(actual: EstadoLocal, nuevo: EstadoLocal): boolean {
  if (actual === nuevo) return false;
  if (actual === 'anulada') return false;
  if (nuevo === 'anulada') return actual === 'emitida' || actual === 'en_proceso' || actual === 'observada';
  if (actual === 'emitida') return false; // una factura validada solo cambia por anulación
  if (actual === 'rechazada') return false;
  return true;
}

export const claveDePago = (sistema: string, pagoId: string, intento: number) => `${sistema}:suscripcion-${pagoId}${intento > 1 ? `:r${intento}` : ''}`;

export function descripcionDe(p: PagoFacturable): string {
  const regalo = p.mesesDeRegalo > 0 ? ` + ${p.mesesDeRegalo} de regalo` : '';
  const per = p.desde && p.hasta ? ` (${p.desde} a ${p.hasta})` : '';
  return `Suscripción ${p.plan ?? 'GESTRO'} · ${p.meses} ${p.meses === 1 ? 'mes' : 'meses'}${regalo}${per}`.slice(0, 250);
}

export interface OpcionesEmision { consumidorFinal?: boolean; excepcionNit?: boolean }

export async function emitirFactura(
  d: { almacen: AlmacenFacturas; cliente: ClienteEmision; config: ConfigEmision },
  pago: PagoFacturable,
  op: OpcionesEmision = {},
): Promise<Resultado> {
  if (pago.montoCent <= 0n) return { ok: false, estado: 'pendiente', codigo: 'MONTO_INVALIDO', mensaje: 'El pago no tiene un monto facturable.', reintentable: false };
  const previa = await d.almacen.obtener(pago.pagoId);
  if (previa && ['emitida', 'en_proceso', 'observada', 'anulada'].includes(previa.estado)) return { ok: true, estado: previa.estado, yaExistia: true };

  // Comprador: datos fiscales válidos o, solo si una persona lo pidió, consumidor final.
  const v = validarDatosFiscales({ ...pago.fiscales, tipo: pago.fiscales.tipo ?? 'NIT' });
  const tieneDatos = !!(pago.fiscales.numero && String(pago.fiscales.numero).trim());
  let comprador: DatosIntento['comprador']; let consumidorFinal = false;
  if (tieneDatos && v.ok) comprador = { tipo: v.datos.tipo, numero: v.datos.numero, complemento: v.datos.complemento ?? null, razonSocial: v.datos.razonSocial, correo: v.datos.correo ?? null };
  else if (op.consumidorFinal) { comprador = { tipo: 'CI', numero: COMPRADOR_CONSUMIDOR_FINAL.numeroDocumento, complemento: null, razonSocial: COMPRADOR_CONSUMIDOR_FINAL.razonSocial, correo: null }; consumidorFinal = true; }
  else {
    const mensaje = tieneDatos && !v.ok ? `Datos fiscales inválidos: ${v.errores.join(' ')}` : 'El cliente no cargó su NIT y razón social.';
    return { ok: false, estado: 'pendiente', codigo: 'SIN_DATOS_FISCALES', mensaje, reintentable: false };
  }

  // Clave: la misma mientras no haya un rechazo del SIN; tras un rechazo, otra (FacturaSIN lo exige).
  const intentoClave = previa ? (previa.estado === 'rechazada' ? previa.intentos + 1 : Math.max(1, previa.intentos)) : 1;
  const clave = previa && previa.estado !== 'rechazada' ? previa.claveIdempotencia : claveDePago(d.config.sistema, pago.pagoId, intentoClave);
  const { totalCent, ivaCent } = desglosar(pago.montoCent);
  const fila = await d.almacen.iniciarIntento(pago, { clave, comprador, consumidorFinal, descripcion: descripcionDe(pago), totalCent, ivaCent });

  const c = d.config;
  const cuerpo = {
    idExterno: clave, sector: c.sector, sucursal: c.sucursal, puntoVenta: c.puntoVenta,
    comprador: {
      tipoDocumento: CODIGO_TIPO_DOC[comprador.tipo as keyof typeof CODIGO_TIPO_DOC], numeroDocumento: comprador.numero,
      ...(comprador.complemento ? { complemento: comprador.complemento } : {}), razonSocial: comprador.razonSocial,
      ...(comprador.correo ? { correo: comprador.correo } : {}), ...(op.excepcionNit ? { codigoExcepcion: 1 as const } : {}),
    },
    metodoPago: c.metodoPago, moneda: 1,
    items: [{ codigoProducto: c.codigoProducto, descripcion: descripcionDe(pago), cantidad: 1, precioUnitario: comoNumero(totalCent), descuento: 0 }],
    extras: { pagoId: pago.pagoId, meses: pago.meses, mesesDeRegalo: pago.mesesDeRegalo, ...(pago.precioUsd ? { precioUsd: pago.precioUsd } : {}), ...(pago.tco ? { tcoUsdBob: pago.tco.usdBob, tcoFecha: pago.tco.fecha } : {}), ...(consumidorFinal ? { consumidorFinal: true } : {}) },
  };
  try {
    const f = await d.cliente.emitir(c.empresa, cuerpo, clave);
    const estado = estadoLocalDe(f.estado);
    const ivaFs = typeof (f.totales as any)?.ivaReferencial === 'number' ? BigInt(Math.round((f.totales as any).ivaReferencial * 100)) : null;
    await d.almacen.guardarResultado(pago.pagoId, { estado, facturasinId: f.id, cuf: f.cuf, numero: f.numero, qrTexto: f.qrTexto, ambientePruebas: f.ambientePruebas !== false, avisoFiscal: f.avisoFiscal ?? null, ivaFsCent: ivaFs, errorCodigo: null, error: null, reintentable: true });
    return { ok: true, estado, yaExistia: false, factura: f };
  } catch (e) {
    let codigo = 'ERROR_RED'; let mensaje = e instanceof Error ? e.message : String(e); let reintentable = true; let estado: EstadoLocal = 'pendiente';
    if (e instanceof FacturaSinError) {
      codigo = e.codigo; mensaje = e.message;
      if (e.codigo === 'SIAT_RECHAZO') { estado = 'rechazada'; reintentable = true; }
      else if (e.estado === 401 || e.estado === 403) reintentable = false; // credencial o permiso: hay que corregir la configuración
      else if (e.estado === 422 || e.estado === 409) reintentable = false; // datos: hay que corregirlos
      else reintentable = e.reintentable;
    }
    await d.almacen.guardarResultado(pago.pagoId, { estado, errorCodigo: codigo, error: mensaje.slice(0, 500), reintentable });
    void fila;
    return { ok: false, estado, codigo, mensaje, reintentable };
  }
}

/** Texto corto para la pantalla de cada estado. */
export const ETIQUETA_ESTADO: Record<EstadoLocal | 'sin_factura', string> = {
  sin_factura: 'Pendiente de emitir', pendiente: 'Pendiente de emitir', emitiendo: 'Emitiendo', en_proceso: 'En proceso (SIN)', emitida: 'Emitida', observada: 'Observada por el SIN', rechazada: 'Rechazada', anulada: 'Anulada',
};
export { deCentavos };
export type { DatosFiscales };
