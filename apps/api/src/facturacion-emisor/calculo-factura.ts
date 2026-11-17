/**
 * Cálculo y armado de la factura de un pedido (Flujo 2: el restaurante factura a su comensal vía FacturaSIN).
 * Todo con enteros (BigInt, centavos): nunca coma flotante. Reglas, todas contrastadas con FacturaSIN:
 *  - importe de línea = cantidad × precio, redondeado UNA vez a centavos, mitad hacia arriba (igual que `subtotalLineaCentavos` de FacturaSIN);
 *  - total facturado = Σ líneas − descuento del pedido. La PROPINA no es parte de la venta: nunca se factura;
 *  - IVA «por dentro» (Ley 843): el precio ya lo incluye; el IVA contenido es el 13 % del importe facturado (FacturaSIN `ivaIncluidoCentavos`),
 *    mitad hacia arriba a centavos. El IT (3 %) es obligación del emisor y no figura en la factura;
 *  - moneda: Bolivianos (código 1), tipo de cambio 1.
 */

export const TASA_IVA_PCT = 13n;
export const MONEDA_BS = 1;
export const SECTOR_COMPRA_VENTA = 1;

/** "12.50" / "12" / "0.5" → centavos (BigInt). Acepta hasta 6 decimales (cantidad × precio) y redondea mitad hacia arriba. */
export function aCentavos(valor: string | number): bigint {
  const s = String(valor).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Monto inválido: ${s}`);
  const neg = s.startsWith('-');
  const [ent, dec = ''] = (neg ? s.slice(1) : s).split('.');
  const m = BigInt(ent + dec);
  const r = dec.length <= 2 ? m * 10n ** BigInt(2 - dec.length) : divRedondeada(m, 10n ** BigInt(dec.length - 2));
  return neg ? -r : r;
}

export function deCentavos(c: bigint): string {
  const neg = c < 0n; const a = neg ? -c : c;
  const s = a.toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** a / b redondeando mitad hacia arriba (lejos de cero), a y b enteros. */
export function divRedondeada(a: bigint, b: bigint): bigint {
  const neg = a < 0n !== b < 0n;
  const A = a < 0n ? -a : a; const B = b < 0n ? -b : b;
  const q = (2n * A + B) / (2n * B);
  return neg ? -q : q;
}

/** Importe de una línea: cantidad × precio, un solo redondeo a centavos. cantidad y precio llegan como texto decimal exacto. */
export function importeDeLinea(cantidad: string, precio: string): bigint {
  const q = partirDecimal(cantidad); const p = partirDecimal(precio);
  const m = q.m * p.m; const e = q.e + p.e;
  return e <= 2 ? m * 10n ** BigInt(2 - e) : divRedondeada(m, 10n ** BigInt(e - 2));
}

function partirDecimal(v: string): { m: bigint; e: number } {
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Número inválido: ${s}`);
  const [ent, dec = ''] = s.split('.');
  return { m: BigInt(ent + dec), e: dec.length };
}

/** IVA contenido en el importe facturado: 13 % del importe (Ley 843, «por dentro»), mitad hacia arriba. */
export const ivaReferencial = (totalCentavos: bigint): bigint => divRedondeada(totalCentavos * TASA_IVA_PCT, 100n);

export interface LineaPedido { itemId: string; nombre: string; cantidad: string; precio: string; codigoSin?: string | null; unidad?: number | null }

export interface CalculoFactura {
  lineas: { itemId: string; importe: bigint }[];
  subtotal: bigint; descuento: bigint; total: bigint; iva: bigint; propinaExcluida: bigint;
}

/** Totales de la factura de un pedido. `propina` se devuelve aparte: NO suma al total facturado. */
export function calcularFactura(p: { lineas: LineaPedido[]; descuento: string; propina?: string }): CalculoFactura {
  if (!p.lineas.length) throw new ErrorFactura('El pedido no tiene platos para facturar.');
  const lineas = p.lineas.map((l) => ({ itemId: l.itemId, importe: importeDeLinea(l.cantidad, l.precio) }));
  const subtotal = lineas.reduce((a, l) => a + l.importe, 0n);
  const descuento = aCentavos(p.descuento);
  if (descuento < 0n) throw new ErrorFactura('El descuento no puede ser negativo.');
  const total = subtotal - descuento;
  if (total <= 0n) throw new ErrorFactura('El total a facturar debe ser mayor que cero.');
  return { lineas, subtotal, descuento, total, iva: ivaReferencial(total), propinaExcluida: aCentavos(p.propina ?? '0') };
}

export class ErrorFactura extends Error {}

/* ---------------------------------- comprador y textos ---------------------------------- */

/** Tipos de documento del comprador (catálogo SIN): 1 CI, 2 CEX, 3 PAS, 4 OD, 5 NIT. */
export const TIPOS_DOCUMENTO = { ci: 1, cex: 2, pasaporte: 3, otro: 4, nit: 5 } as const;
export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO;

/** Texto libre de datos fiscales: admite letras (con tildes, ñ, ü), números y puntuación habitual; rechaza controles y `<>`. */
const PERMITIDO = /^[\p{L}\p{M}\p{N} .,;:&()/'"#°ºª@+\-–_%!?¡¿]+$/u;
export function limpiarTexto(v: unknown, campo: string, min: number, max: number): string {
  if (typeof v !== 'string') throw new ErrorFactura(`${campo}: escribe un texto.`);
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (t.length < min) throw new ErrorFactura(min <= 1 ? `${campo} es obligatorio.` : `${campo}: escribe al menos ${min} caracteres.`);
  if (t.length > max) throw new ErrorFactura(`${campo}: máximo ${max} caracteres.`);
  if (!PERMITIDO.test(t)) throw new ErrorFactura(`${campo} tiene caracteres no permitidos (usa letras, números y . , - & ( ) / ' #).`);
  return t;
}

export function validarNit(nit: unknown, campo = 'NIT'): string {
  const t = typeof nit === 'string' ? nit.trim() : '';
  if (!/^\d{5,13}$/.test(t)) throw new ErrorFactura(`${campo}: solo números, de 5 a 13 dígitos, sin guiones ni espacios.`);
  return t;
}

export interface CompradorEntrada { tipo: TipoDocumento; numero: string; complemento?: string; razonSocial: string; correo?: string; nitConExcepcion?: boolean }
export interface CompradorSalida { tipoDocumento: number; numeroDocumento: string; complemento?: string; razonSocial: string; correo?: string; codigoExcepcion: 0 | 1 }

/** Comprador «sin nombre»: CI 0 y razón social S/N, como acepta el SIN para consumidor final. */
export const CONSUMIDOR_FINAL: CompradorSalida = { tipoDocumento: 1, numeroDocumento: '0', razonSocial: 'S/N', codigoExcepcion: 0 };

export function armarComprador(c: CompradorEntrada): CompradorSalida {
  const tipo = TIPOS_DOCUMENTO[c.tipo];
  if (!tipo) throw new ErrorFactura('Tipo de documento no válido.');
  const numero = typeof c.numero === 'string' ? c.numero.trim().replace(/\s+/g, '') : '';
  if (c.tipo === 'nit') validarNit(numero, 'NIT del comensal');
  else if (c.tipo === 'ci') { if (!/^\d{4,10}$/.test(numero)) throw new ErrorFactura('CI: solo números, de 4 a 10 dígitos (el complemento va aparte).'); }
  else if (c.tipo === 'cex') { if (!/^\d{4,12}$/.test(numero)) throw new ErrorFactura('Cédula de extranjero: solo números, de 4 a 12 dígitos.'); }
  else if (!/^[A-Za-z0-9-]{4,20}$/.test(numero)) throw new ErrorFactura(c.tipo === 'pasaporte' ? 'Pasaporte: de 4 a 20 letras o números.' : 'Documento: de 4 a 20 letras o números.');
  const complemento = c.complemento?.trim();
  if (complemento) { if (c.tipo !== 'ci') throw new ErrorFactura('El complemento solo aplica al CI.'); if (!/^[0-9A-Za-z]{1,5}$/.test(complemento)) throw new ErrorFactura('Complemento del CI: hasta 5 letras o números.'); }
  const correo = c.correo?.trim();
  if (correo && (correo.length > 120 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(correo))) throw new ErrorFactura('El correo no es válido.');
  if (c.nitConExcepcion && c.tipo !== 'nit') throw new ErrorFactura('La excepción de NIT solo aplica a un NIT.');
  return { tipoDocumento: tipo, numeroDocumento: numero, ...(complemento ? { complemento } : {}), razonSocial: limpiarTexto(c.razonSocial, 'Razón social o nombre', 1, 200), ...(correo ? { correo } : {}), codigoExcepcion: c.nitConExcepcion ? 1 : 0 };
}

/* ---------------------------------- pago y payload ---------------------------------- */

/**
 * Códigos del catálogo `metodoPago` del SIN por método de cobro de GESTRO. Son CONFIGURACIÓN de cada restaurante (billing_settings.payment_codes),
 * leída del catálogo sincronizado de FacturaSIN. Confirmados oficialmente: 1 efectivo, 2 tarjeta, 5 «otros». El valor por defecto de «otro» (7,
 * transferencia) es NO CONFIRMADO — definir con el catálogo del SIN; mientras `codes_confirmed` sea false el panel lo avisa.
 */
export interface CodigosPago { efectivo: number; tarjeta: number; otro: number }
export const CODIGOS_PAGO_POR_DEFECTO: CodigosPago = { efectivo: 1, tarjeta: 2, otro: 7 };
export function metodoPagoSin(metodo: string, codigos: CodigosPago = CODIGOS_PAGO_POR_DEFECTO): number {
  if (metodo === 'efectivo') return codigos.efectivo;
  if (metodo === 'tarjeta') return codigos.tarjeta;
  return codigos.otro;
}

/** FacturaSIN exige un número de tarjeta enmascarado: primeros 4 + ceros + últimos 4. Solo se piden esos 8 dígitos. */
export function tarjetaEnmascarada(primeros4: string, ultimos4: string): string {
  if (!/^\d{4}$/.test(primeros4) || !/^\d{4}$/.test(ultimos4)) throw new ErrorFactura('Tarjeta: indica los primeros 4 y los últimos 4 dígitos.');
  return `${primeros4}00000000${ultimos4}`;
}

/** Solo sucursal y punto de venta (y los codigos de metodo de pago): actividad, producto y unidad los completa FacturaSIN desde el rubro de la empresa. */
export interface ConfigEmisor { sucursal: number; puntoVenta: number; codigosPago?: CodigosPago }

export interface PayloadFactura {
  idExterno: string; sector: number; sucursal: number; puntoVenta: number; comprador: CompradorSalida; metodoPago: number; numeroTarjeta?: string;
  moneda: number; tipoCambio: null; descuentoAdicional: number;
  /** Lineas LIBRES (plato = descripcion + cantidad + precio). Los codigos del SIN solo viajan si el propio plato los trae; si no, los pone FacturaSIN del rubro. */
  items: { codigoProducto: string; descripcion: string; cantidad: number; precioUnitario: number; descuento: number; unidadMedida?: number; codigoProductoSin?: string }[];
}

export function armarPayload(p: { idExterno: string; lineas: LineaPedido[]; descuento: string; comprador: CompradorSalida; metodo: string; numeroTarjeta?: string; config: ConfigEmisor }): PayloadFactura {
  return {
    idExterno: p.idExterno, sector: SECTOR_COMPRA_VENTA, sucursal: p.config.sucursal, puntoVenta: p.config.puntoVenta, comprador: p.comprador,
    metodoPago: metodoPagoSin(p.metodo, p.config.codigosPago), ...(p.metodo === 'tarjeta' && p.numeroTarjeta ? { numeroTarjeta: p.numeroTarjeta } : {}),
    moneda: MONEDA_BS, tipoCambio: null, descuentoAdicional: Number(deCentavos(aCentavos(p.descuento))),
    items: p.lineas.map((l) => ({
      codigoProducto: l.itemId.length > 60 ? l.itemId.slice(0, 60) : l.itemId, descripcion: limpiarTexto(l.nombre, 'Nombre del plato', 1, 500),
      cantidad: Number(l.cantidad), precioUnitario: Number(l.precio), descuento: 0,
      ...(l.unidad ? { unidadMedida: l.unidad } : {}), ...((l.codigoSin ?? '').trim() ? { codigoProductoSin: (l.codigoSin ?? '').trim() } : {}),
    })),
  };
}

/** Clave de idempotencia y `idExterno`: pedido + intento. Reintentar la MISMA clave nunca duplica; un intento nuevo solo tras rechazo o anulación. */
export const idExternoDe = (orderId: string, intento: number) => `gestro:${orderId}:${intento}`;

/** Estados de FacturaSIN → estado local. */
export function estadoLocal(estadoFs: string): 'pendiente' | 'validada' | 'observada' | 'contingencia' | 'rechazada' | 'anulada' {
  switch (estadoFs) {
    case 'validada': return 'validada';
    case 'observada': return 'observada';
    case 'contingencia': return 'contingencia';
    case 'rechazada': return 'rechazada';
    case 'anulada': return 'anulada';
    default: return 'pendiente';
  }
}

/** Retraso del reintento n (1, 2, 3…): 30 s, 1 min, 2, 4… hasta 15 min. */
export function esperaDeReintento(n: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, n - 1));
}
