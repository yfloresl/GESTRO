/** Prueba del estándar QR (v1.2): firma, tipos, tamaño, limpieza. Copia idéntica junto a kyros-qr-imagen.ts. Requiere vitest. */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { validarYLimpiarQr, detectarTipoQr, ErrorQr, QR_MAX_BYTES, cabecerasServirQr, limpiarBancoQr, urlQrAntiguaValida } from './kyros-qr-imagen';

function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(tipo: string, data: Buffer): Buffer {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(cuerpo));
  return Buffer.concat([l, cuerpo, c]);
}
function png(n = 64, extra: Buffer[] = [], cola = Buffer.alloc(0)): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 0;
  const crudo = Buffer.alloc((n + 1) * n);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(crudo)), chunk('IEND', Buffer.alloc(0)), cola]);
}
function jpeg(n = 64, cola = Buffer.alloc(0)): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, n >> 8, n & 255, n >> 8, n & 255, 1, 1, 0x11, 0]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 0]), Buffer.from('Exif\0<script>alert(1)</script>')]); app1.writeUInt16BE(app1.length - 2, 2);
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), Buffer.from('comentario')]); com.writeUInt16BE(com.length - 2, 2);
  const sos = Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, com, sof, sos, Buffer.from([1, 2, 3, 4]), Buffer.from([0xff, 0xd9]), cola]);
}
function webp(n = 64, cola = Buffer.alloc(0)): Buffer {
  const d = Buffer.alloc(5); d[0] = 0x2f; d.writeUInt32LE((n - 1) | ((n - 1) << 14), 1);
  const ch = (t: string, dd: Buffer) => { const h = Buffer.alloc(8); h.write(t, 0, 'latin1'); h.writeUInt32LE(dd.length, 4); return Buffer.concat([h, dd, dd.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const cuerpo = Buffer.concat([Buffer.from('WEBP'), ch('EXIF', Buffer.from('<script>x</script>')), ch('VP8L', d)]);
  const cab = Buffer.alloc(8); cab.write('RIFF', 0, 'latin1'); cab.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([cab, cuerpo, cola]);
}
const codigo = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof ErrorQr ? e.codigo : 'otro'; } };

describe('QR de cobro: validación y limpieza', () => {
  it('acepta PNG, JPEG y WebP válidos con el tipo detectado por firma', () => {
    expect(validarYLimpiarQr(png())).toMatchObject({ mime: 'image/png', ancho: 64, alto: 64 });
    expect(validarYLimpiarQr(jpeg())).toMatchObject({ mime: 'image/jpeg', ancho: 64, alto: 64 });
    expect(validarYLimpiarQr(webp())).toMatchObject({ mime: 'image/webp', ancho: 64, alto: 64 });
  });
  it('rechaza SVG aunque venga como .png', () => {
    expect(codigo(() => validarYLimpiarQr(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))).toBe('tipo');
  });
  it('rechaza un archivo falso (HTML/texto) con extensión .png', () => {
    expect(codigo(() => validarYLimpiarQr(Buffer.from('<html><script>alert(1)</script></html>')))).toBe('tipo');
    expect(codigo(() => validarYLimpiarQr(Buffer.from('GIF89a......')))).toBe('tipo');
  });
  it('rechaza vacío, más de 2 MB, firma válida pero cuerpo dañado y dimensiones fuera de rango', () => {
    expect(codigo(() => validarYLimpiarQr(Buffer.alloc(0)))).toBe('vacio');
    expect(codigo(() => validarYLimpiarQr(Buffer.concat([png(), Buffer.alloc(QR_MAX_BYTES)])))).toBe('tamano');
    expect(codigo(() => validarYLimpiarQr(png().subarray(0, 40)))).toBe('corrupta');
    expect(codigo(() => validarYLimpiarQr(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('basura')])))).toBe('corrupta');
    expect(codigo(() => validarYLimpiarQr(png(8)))).toBe('dimensiones');
    expect(codigo(() => validarYLimpiarQr(jpeg(5000)))).toBe('dimensiones');
  });
  it('acepta justo 2 MB de límite y rechaza 2 MB + 1', () => {
    expect(QR_MAX_BYTES).toBe(2097152);
    expect(codigo(() => validarYLimpiarQr(Buffer.alloc(QR_MAX_BYTES + 1, 0x89)))).toBe('tamano');
  });
  it('recodifica: elimina metadatos, scripts y bytes posteriores al final', () => {
    const sucio = png(64, [chunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script>'))], Buffer.from('<script>alert(1)</script>'));
    const r = validarYLimpiarQr(sucio);
    expect(r.bytes.includes(Buffer.from('script'))).toBe(false);
    expect(r.bytes.length).toBeLessThan(sucio.length);
    const j = validarYLimpiarQr(jpeg(64, Buffer.from('<script>alert(1)</script>')));
    expect(j.bytes.includes(Buffer.from('script'))).toBe(false);
    expect(j.bytes.includes(Buffer.from('comentario'))).toBe(false);
    const w = validarYLimpiarQr(webp(64, Buffer.from('<script>x</script>')));
    expect(w.bytes.includes(Buffer.from('script'))).toBe(false);
    expect(detectarTipoQr(w.bytes)).toBe('image/webp');
    expect(w.bytes.readUInt32LE(4) + 8).toBe(w.bytes.length);
  });
  it('lo recodificado vuelve a validar (idempotente)', () => {
    const r = validarYLimpiarQr(png());
    expect(validarYLimpiarQr(r.bytes).bytes.equals(r.bytes)).toBe(true);
  });
  it('sirve con tipo fijo, nosniff, inline y sin scripts', () => {
    const h = cabecerasServirQr('image/png', 10, '"abc"');
    expect(h['Content-Type']).toBe('image/png');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Content-Disposition']).toBe('inline');
    expect(h['Content-Security-Policy']).toContain("default-src 'none'");
  });
  it('banco y URL antigua se limpian', () => {
    expect(limpiarBancoQr('  <b>Banco Unión</b>  ')).toBe('bBanco Unión/b');
    expect(limpiarBancoQr('')).toBeNull();
    expect(urlQrAntiguaValida('javascript:alert(1)')).toBeNull();
    expect(urlQrAntiguaValida('https://ejemplo.com/qr.png')).toBe('https://ejemplo.com/qr.png');
  });
});
