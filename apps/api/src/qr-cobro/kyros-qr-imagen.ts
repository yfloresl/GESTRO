/**
 * ESTANDAR KYROS v1.2 — QR de cobro: validación y limpieza de la imagen SUBIDA (servidor). Copia idéntica en los 7 sistemas
 * (apps/api/src/<carpeta del módulo qr-cobro>/kyros-qr-imagen.ts). Solo depende de Buffer de Node; sin dependencias nuevas.
 *
 * Reglas (lecciones de PM-048, XSS por adjuntos):
 *  - Solo PNG, JPEG o WebP, decididos por la FIRMA (magic bytes), jamás por extensión ni Content-Type declarado.
 *  - Máximo 2 MB; ancho y alto entre 64 y 4096 px. SVG, GIF, HTML, PDF, etc. se rechazan.
 *  - La imagen se RECONSTRUYE conservando solo lo imprescindible para dibujarla: se descartan metadatos, comentarios, EXIF/XMP,
 *    perfiles y cualquier byte extra tras el final (donde se esconden scripts). Sin `sharp` (no hay dependencia en los repos).
 *  - Se devuelve el tipo validado: el servidor sirve SIEMPRE con ese Content-Type fijo, `X-Content-Type-Options: nosniff`.
 */

export const QR_MAX_BYTES = 2 * 1024 * 1024;
export const QR_MIN_PX = 64;
export const QR_MAX_PX = 4096;
export type MimeQr = 'image/png' | 'image/jpeg' | 'image/webp';
export type CodigoErrorQr = 'vacio' | 'tamano' | 'tipo' | 'corrupta' | 'dimensiones';

export class ErrorQr extends Error {
  constructor(public readonly codigo: CodigoErrorQr, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorQr';
  }
}

/** Mensajes en lenguaje simple (es). La web muestra los suyos por código en es/en. */
const MENSAJES: Record<CodigoErrorQr, string> = {
  vacio: 'No llegó ningún archivo. Elige la imagen de tu QR e inténtalo de nuevo.',
  tamano: 'La imagen es demasiado pesada (máximo 2 MB). Usa una captura o foto más liviana.',
  tipo: 'Solo se aceptan imágenes PNG, JPG o WebP. Sube la captura o el archivo de tu QR.',
  corrupta: 'No se pudo leer la imagen: está dañada o no es una imagen real. Prueba con otra.',
  dimensiones: 'La imagen es muy pequeña o muy grande (entre 64 y 4096 píxeles por lado).',
};
const falla = (c: CodigoErrorQr): never => { throw new ErrorQr(c, MENSAJES[c]); };

/** Tipo por firma; null si no es PNG, JPEG ni WebP. */
export function detectarTipoQr(b: Buffer): MimeQr | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

let TABLA_CRC: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!TABLA_CRC) {
    TABLA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TABLA_CRC[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ImagenQrLimpia { mime: MimeQr; bytes: Buffer; ancho: number; alto: number }

function limpiarPng(b: Buffer): ImagenQrLimpia {
  const CONSERVAR = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  const salida: Buffer[] = [b.subarray(0, 8)];
  let pos = 8, ancho = 0, alto = 0, vioIdat = false, vioIend = false, primero = true;
  while (pos + 12 <= b.length && !vioIend) {
    const len = b.readUInt32BE(pos);
    if (len > b.length) falla('corrupta');
    const fin = pos + 12 + len;
    if (fin > b.length) falla('corrupta');
    const tipo = b.toString('latin1', pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(tipo)) falla('corrupta');
    if (b.readUInt32BE(fin - 4) !== crc32(b.subarray(pos + 4, fin - 4))) falla('corrupta');
    if (primero) { if (tipo !== 'IHDR' || len !== 13) falla('corrupta'); ancho = b.readUInt32BE(pos + 8); alto = b.readUInt32BE(pos + 12); primero = false; }
    if (tipo === 'IDAT') vioIdat = true;
    if (tipo === 'IEND') vioIend = true;
    if (CONSERVAR.has(tipo)) salida.push(b.subarray(pos, fin));
    pos = fin;
  }
  if (primero || !vioIdat || !vioIend) falla('corrupta'); // sin IEND = recortada; lo que venga DESPUÉS de IEND se descarta
  return { mime: 'image/png', bytes: Buffer.concat(salida), ancho, alto };
}

function limpiarJpeg(b: Buffer): ImagenQrLimpia {
  const salida: Buffer[] = [b.subarray(0, 2)];
  let pos = 2, ancho = 0, alto = 0, vioSof = false;
  for (;;) {
    while (pos < b.length && b[pos] === 0xff && b[pos + 1] === 0xff) pos++; // relleno
    if (pos + 4 > b.length || b[pos] !== 0xff) falla('corrupta');
    const m = b[pos + 1];
    if (m === 0xd9) falla('corrupta'); // EOI antes de imagen
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { pos += 2; continue; } // marcadores sin longitud
    const len = b.readUInt16BE(pos + 2);
    if (len < 2 || pos + 2 + len > b.length) falla('corrupta');
    const seg = b.subarray(pos, pos + 2 + len);
    const esSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (esSof) {
      if (len < 8) falla('corrupta');
      alto = b.readUInt16BE(pos + 5); ancho = b.readUInt16BE(pos + 7); vioSof = true;
    }
    const descartar = (m >= 0xe1 && m <= 0xed) || m === 0xef || m === 0xfe; // EXIF/XMP/ICC/comentarios; se conserva JFIF (E0) y Adobe (EE)
    if (!descartar) salida.push(seg);
    pos += 2 + len;
    if (m === 0xda) { // inicio del scan: el resto son datos de imagen hasta el último EOI; lo posterior se descarta
      if (!vioSof) falla('corrupta');
      const eoi = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi < pos) falla('corrupta');
      salida.push(b.subarray(pos, eoi + 2));
      break;
    }
  }
  return { mime: 'image/jpeg', bytes: Buffer.concat(salida), ancho, alto };
}

function limpiarWebp(b: Buffer): ImagenQrLimpia {
  const total = b.readUInt32LE(4) + 8;
  if (total > b.length || total < 20) falla('corrupta');
  const cuerpo = b.subarray(0, total);
  const trozos: Buffer[] = [];
  let pos = 12, ancho = 0, alto = 0, imagenes = 0, vp8x: Buffer | null = null;
  while (pos + 8 <= cuerpo.length) {
    const tipo = cuerpo.toString('latin1', pos, pos + 4);
    const len = cuerpo.readUInt32LE(pos + 4);
    const fin = pos + 8 + len;
    if (fin > cuerpo.length) falla('corrupta');
    const dato = cuerpo.subarray(pos + 8, fin);
    const completo = cuerpo.subarray(pos, Math.min(fin + (len & 1), cuerpo.length));
    if (tipo === 'ANIM' || tipo === 'ANMF') falla('tipo'); // animadas: no
    if (tipo === 'VP8X') {
      if (len < 10) falla('corrupta');
      ancho = 1 + dato.readUIntLE(4, 3); alto = 1 + dato.readUIntLE(7, 3);
      vp8x = Buffer.from(completo); vp8x[8] &= 0x10; // solo se conserva el indicador de transparencia (alfa)
    } else if (tipo === 'VP8L') {
      if (len < 5 || dato[0] !== 0x2f) falla('corrupta');
      const v = dato.readUInt32LE(1); ancho = (v & 0x3fff) + 1; alto = ((v >> 14) & 0x3fff) + 1;
      imagenes++; trozos.push(completo);
    } else if (tipo === 'VP8 ') {
      if (len < 10 || dato[3] !== 0x9d || dato[4] !== 0x01 || dato[5] !== 0x2a) falla('corrupta');
      ancho = dato.readUInt16LE(6) & 0x3fff; alto = dato.readUInt16LE(8) & 0x3fff;
      imagenes++; trozos.push(completo);
    } else if (tipo === 'ALPH') trozos.push(completo);
    pos = fin + (len & 1);
  }
  if (imagenes !== 1) falla('corrupta');
  const partes = vp8x ? [vp8x, ...trozos] : trozos;
  const resto = Buffer.concat(partes);
  const cab = Buffer.alloc(12);
  cab.write('RIFF', 0, 'latin1'); cab.writeUInt32LE(4 + resto.length, 4); cab.write('WEBP', 8, 'latin1');
  return { mime: 'image/webp', bytes: Buffer.concat([cab, resto]), ancho, alto };
}

/**
 * Valida y limpia la imagen subida. Lanza ErrorQr (codigo + mensaje simple) si no cumple.
 * El resultado es lo ÚNICO que se guarda; los bytes originales se descartan.
 */
export function validarYLimpiarQr(entrada: Buffer | Uint8Array | null | undefined): ImagenQrLimpia {
  if (!entrada || entrada.length === 0) return falla('vacio');
  const b = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada);
  if (b.length > QR_MAX_BYTES) return falla('tamano');
  const tipo = detectarTipoQr(b);
  if (!tipo) return falla('tipo');
  let r: ImagenQrLimpia;
  try {
    r = tipo === 'image/png' ? limpiarPng(b) : tipo === 'image/jpeg' ? limpiarJpeg(b) : limpiarWebp(b);
  } catch (e) {
    if (e instanceof ErrorQr) throw e;
    return falla('corrupta'); // cualquier lectura fuera de rango (RangeError) = archivo dañado
  }
  if (r.ancho < QR_MIN_PX || r.alto < QR_MIN_PX || r.ancho > QR_MAX_PX || r.alto > QR_MAX_PX) return falla('dimensiones');
  return r;
}

/** Cabeceras fijas para servir un QR guardado (el tipo sale de la base, nunca del cliente). */
export function cabecerasServirQr(mime: MimeQr, bytes: number, etag: string): Record<string, string> {
  return {
    'Content-Type': mime,
    'Content-Length': String(bytes),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'public, max-age=300, must-revalidate', // corto: al reemplazar el QR cambia el id y el viejo deja de existir
    ETag: etag,
  };
}

/** Respaldo de LECTURA de datos antiguos: solo se acepta una URL https externa bien formada para mostrarla con el aviso «Sube tu QR». */
export function urlQrAntiguaValida(u: string | null | undefined): string | null {
  if (!u) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(x.hostname) ? x.toString() : null; } catch { return null; }
}

/** Nombre del banco opcional: texto plano corto, sin etiquetas. */
export function limpiarBancoQr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 60);
  return s || null;
}
