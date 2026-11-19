import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

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
function png(n = 64): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((n + 1) * n))), chunk('IEND', Buffer.alloc(0))]);
}
function jpeg(n = 64): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, n >> 8, n & 255, n >> 8, n & 255, 1, 1, 0x11, 0]);
  const sos = Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, sos, Buffer.from([1, 2, 3, 4]), Buffer.from([0xff, 0xd9])]);
}
function webp(n = 64): Buffer {
  const d = Buffer.alloc(5); d[0] = 0x2f; d.writeUInt32LE((n - 1) | ((n - 1) << 14), 1);
  const h = Buffer.alloc(8); h.write('VP8L', 0, 'latin1'); h.writeUInt32LE(d.length, 4);
  const cuerpo = Buffer.concat([Buffer.from('WEBP'), h, d, Buffer.alloc(1)]);
  const cab = Buffer.alloc(8); cab.write('RIFF', 0, 'latin1'); cab.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([cab, cuerpo]);
}

const subirPlat = (token: string, archivo: Buffer | string, nombre = 'qr.png', banco?: string) => {
  const q = t.api().put('/api/v1/qr-cobro/plataforma').set('Authorization', `Bearer ${token}`).attach('file', Buffer.from(archivo), nombre);
  return banco ? q.field('banco', banco) : q;
};
const subirCli = (token: string, rid: string, id: string, archivo: Buffer | string, nombre = 'qr.png') =>
  t.api().put(`/api/v1/qr-cobro/cliente/${id}`).set('Authorization', `Bearer ${token}`).set('X-Restaurant-Id', rid).attach('file', Buffer.from(archivo), nombre);
const idDe = (url: string) => url.split('/').pop()!;
const limpiarPlataforma = async () => { await t.owner.query(`DELETE FROM kyros_qr_cobro WHERE ambito = 'plataforma'`); await t.owner.query('UPDATE platform_settings SET payment_qr_url = NULL WHERE id = 1'); };

describe('QR de cobro por archivo: validación del archivo', () => {
  it('acepta PNG, JPEG y WebP válidos', async () => {
    await limpiarPlataforma();
    const k = await t.nuevaPlataforma();
    for (const [buf, nombre, mime] of [[png(), 'a.png', 'image/png'], [jpeg(), 'a.jpg', 'image/jpeg'], [webp(), 'a.webp', 'image/webp']] as const) {
      const r = await subirPlat(k.token, buf, nombre, 'Banco Unión');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ banco: 'Banco Unión', esRespaldo: false });
      expect((await t.api().get(r.body.url)).headers['content-type']).toBe(mime);
    }
  });

  it('rechaza SVG, archivos falsos con extensión .png y archivos vacíos, con {codigo, message}', async () => {
    const k = await t.nuevaPlataforma();
    const svg = await subirPlat(k.token, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'qr.svg');
    expect(svg.status).toBe(400); expect(svg.body.codigo).toBe('tipo'); expect(typeof svg.body.message).toBe('string');
    const falso = await subirPlat(k.token, '<html><script>alert(1)</script></html>', 'qr.png');
    expect(falso.status).toBe(400); expect(falso.body.codigo).toBe('tipo');
    const sinArchivo = await t.api().put('/api/v1/qr-cobro/plataforma').set('Authorization', `Bearer ${k.token}`).field('banco', 'x');
    expect(sinArchivo.status).toBe(400); expect(sinArchivo.body.codigo).toBe('vacio');
  });

  it('rechaza un archivo de más de 2 MB con 413', async () => {
    const k = await t.nuevaPlataforma();
    const grande = Buffer.concat([png(), Buffer.alloc(2 * 1024 * 1024 + 10)]);
    const r = await subirPlat(k.token, grande);
    expect(r.status).toBe(413); expect(r.body.codigo).toBe('tamano');
  });
});

describe('QR de cobro: permisos (decide el servidor)', () => {
  it('plataforma: solo el equipo de Kyros-Tech; un dueño de restaurante y la gente sin sesión, no', async () => {
    const d = await t.nuevoRestaurante();
    expect((await subirPlat(d.token, png())).status).toBe(403);
    expect((await t.api().put('/api/v1/qr-cobro/plataforma').attach('file', png(), 'qr.png')).status).toBe(401);
    expect((await t.api().delete('/api/v1/qr-cobro/plataforma').set('Authorization', `Bearer ${d.token}`)).status).toBe(403);
    const k = await t.nuevaPlataforma();
    expect((await subirPlat(k.token, png())).status).toBe(200);
  });

  it('cliente: solo el administrador de ESA sucursal; el mesero, otro restaurante y la plataforma sin soporte, no', async () => {
    const a = await t.nuevoRestaurante('Casa A'); const b = await t.nuevoRestaurante('Casa B');
    expect((await subirCli(a.token, a.rid, a.rid, png())).status).toBe(200);
    // el dueño de B intenta escribir en la sucursal A (con su propia cabecera y con la de A)
    expect((await subirCli(b.token, b.rid, a.rid, png())).status).toBe(403);
    expect((await subirCli(b.token, a.rid, a.rid, png())).status).toBe(403);
    expect((await t.api().delete(`/api/v1/qr-cobro/cliente/${a.rid}`).set('Authorization', `Bearer ${b.token}`).set('X-Restaurant-Id', b.rid)).status).toBe(403);
    // mesero de A
    const inv = await t.con(a.token, a.rid).post('/personal', { nombre: 'Carlos Mesero', correo: `${randomUUID()}@t.bo`, roles: ['mesero'] });
    const m = await t.entrarConCodigo(inv.body.codigo);
    expect((await subirCli(m.token, a.rid, a.rid, png())).status).toBe(403);
    expect((await t.api().get(`/api/v1/qr-cobro/cliente/${a.rid}`).set('Authorization', `Bearer ${m.token}`).set('X-Restaurant-Id', a.rid)).status).toBe(403);
    // el dueño de A lo ve; B no ve el de A
    const ver = await t.con(a.token, a.rid).get(`/qr-cobro/cliente/${a.rid}`);
    expect(ver.status).toBe(200); expect(ver.body.url).toMatch(/\/public\/qr\//);
    expect((await t.con(b.token, b.rid).get(`/qr-cobro/cliente/${a.rid}`)).status).toBe(403);
    expect((await t.con(b.token, b.rid).get(`/qr-cobro/cliente/${b.rid}`)).body).toEqual({ url: null, banco: null, esRespaldo: false });
    // la plataforma no escribe en un cliente (ni siquiera con la cabecera de ese cliente)
    const k = await t.nuevaPlataforma();
    expect((await subirCli(k.token, a.rid, a.rid, png())).status).toBe(403);
  });
});

describe('QR de cobro: reemplazo, servido, respaldo y auditoría', () => {
  it('reemplazar crea un id nuevo y el anterior deja de existir (404); quitar lo apaga', async () => {
    await limpiarPlataforma();
    const k = await t.nuevaPlataforma();
    const uno = (await subirPlat(k.token, png(64))).body.url as string;
    const dos = (await subirPlat(k.token, png(80))).body.url as string;
    expect(idDe(uno)).not.toBe(idDe(dos));
    expect((await t.api().get(uno)).status).toBe(404);
    expect((await t.api().get(dos)).status).toBe(200);
    expect((await t.api().get('/api/v1/qr-cobro/plataforma')).body.url).toBe(dos);   // público: lo ve quien paga
    expect((await t.api().delete('/api/v1/qr-cobro/plataforma').set('Authorization', `Bearer ${k.token}`)).status).toBe(200);
    expect((await t.api().get(dos)).status).toBe(404);
    expect((await t.api().get('/api/v1/qr-cobro/plataforma')).body).toEqual({ url: null, banco: null, esRespaldo: false });
  });

  it('sirve con Content-Type fijo, nosniff, inline y ETag (304 si coincide); un id que no es UUID da 404', async () => {
    await limpiarPlataforma();
    const k = await t.nuevaPlataforma();
    const url = (await subirPlat(k.token, png())).body.url as string;
    const r = await t.api().get(url);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-disposition']).toBe('inline');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers.etag).toBeTruthy();
    expect((await t.api().get(url).set('If-None-Match', r.headers.etag)).status).toBe(304);
    expect((await t.api().get('/api/v1/public/qr/no-es-uuid')).status).toBe(404);
    expect((await t.api().get(`/api/v1/public/qr/${randomUUID()}`)).status).toBe(404);
  });

  it('el dato antiguo (URL) sirve de respaldo de lectura y el archivo subido gana siempre', async () => {
    await limpiarPlataforma();
    await t.owner.query(`UPDATE platform_settings SET payment_qr_url = 'https://ejemplo.bo/qr-viejo.png' WHERE id = 1`);
    const antes = (await t.api().get('/api/v1/qr-cobro/plataforma')).body;
    expect(antes).toEqual({ url: 'https://ejemplo.bo/qr-viejo.png', banco: null, esRespaldo: true });
    await t.owner.query(`UPDATE platform_settings SET payment_qr_url = 'javascript:alert(1)' WHERE id = 1`);
    expect((await t.api().get('/api/v1/qr-cobro/plataforma')).body.url).toBeNull();   // URL no válida: no se muestra
    await t.owner.query(`UPDATE platform_settings SET payment_qr_url = 'https://ejemplo.bo/qr-viejo.png' WHERE id = 1`);
    const k = await t.nuevaPlataforma();
    const nuevo = (await subirPlat(k.token, png())).body.url as string;
    const despues = (await t.api().get('/api/v1/qr-cobro/plataforma')).body;
    expect(despues).toMatchObject({ url: nuevo, esRespaldo: false });
  });

  it('cada cambio queda en la auditoría: subir, reemplazar y quitar (quién, ámbito, sucursal)', async () => {
    await limpiarPlataforma();
    const d = await t.nuevoRestaurante('Casa Audit');
    await subirCli(d.token, d.rid, d.rid, png());
    await subirCli(d.token, d.rid, d.rid, png(70));
    expect((await t.api().delete(`/api/v1/qr-cobro/cliente/${d.rid}`).set('Authorization', `Bearer ${d.token}`).set('X-Restaurant-Id', d.rid)).status).toBe(200);
    const filas = (await t.owner.query(`SELECT action, user_id::text AS u, restaurant_id::text AS r, after FROM audit_log WHERE action LIKE 'qr_cobro.%' AND restaurant_id = $1 ORDER BY id`, [d.rid])).rows;
    expect(filas.map((f) => f.action)).toEqual(['qr_cobro.subir', 'qr_cobro.reemplazar', 'qr_cobro.quitar']);
    expect(filas.every((f) => f.u === d.userId && f.r === d.rid && f.after.ambito === 'cliente')).toBe(true);
    const k = await t.nuevaPlataforma();
    await subirPlat(k.token, png());
    const p = (await t.owner.query(`SELECT action, user_id::text AS u, restaurant_id, after FROM audit_log WHERE action LIKE 'qr_cobro.%' AND user_id = $1`, [k.userId])).rows;
    expect(p).toHaveLength(1); expect(p[0]).toMatchObject({ u: k.userId, restaurant_id: null }); expect(p[0].after.ambito).toBe('plataforma');
  });

  it('suscripción: tieneQr refleja el archivo de la plataforma', async () => {
    await limpiarPlataforma();
    const d = await t.nuevoRestaurante('Casa Cobro');
    expect((await t.con(d.token, d.rid).get('/suscripcion')).body.cobro.tieneQr).toBe(false);
    const k = await t.nuevaPlataforma();
    await subirPlat(k.token, png());
    expect((await t.con(d.token, d.rid).get('/suscripcion')).body.cobro.tieneQr).toBe(true);
  });
});
