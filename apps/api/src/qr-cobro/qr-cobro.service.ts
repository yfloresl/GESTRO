import { HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { BD, Bd } from '../database/database.module';
import { StorageService } from '../storage/storage.service';
import { cabecerasServirQr, ErrorQr, limpiarBancoQr, MimeQr, urlQrAntiguaValida, validarYLimpiarQr } from './kyros-qr-imagen';

export type AmbitoQr = 'plataforma' | 'cliente';
export interface QrVista { url: string | null; banco: string | null; esRespaldo: boolean }
export const MAX_CAMBIOS_POR_HORA = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUTA_PUBLICA = '/api/v1/public/qr';

/** Error de QR con la forma {code, codigo, message}: la web muestra su propio texto es/en según `codigo`. */
export function errorHttpQr(codigo: string, mensaje: string, estado: number) {
  return new HttpException({ code: codigo, codigo, message: mensaje }, estado);
}
export function deErrorQr(e: unknown): unknown {
  return e instanceof ErrorQr ? errorHttpQr(e.codigo, e.message, e.codigo === 'tamano' ? 413 : 400) : e;
}

/**
 * QR de cobro por ARCHIVO (estándar Kyros v1.2). La plataforma sube el suyo (suscripción); cada sucursal sube el suyo (cobros QR en caja).
 * Los permisos los decide el controlador con las guardas del sistema; aquí se valida el archivo, se reemplaza en una transacción y se audita.
 */
@Injectable()
export class QrCobroService {
  constructor(@Inject(BD) private readonly bd: Bd, @Inject(StorageService) private readonly storage: StorageService) {}

  private propietario(ambito: AmbitoQr, id?: string) { return ambito === 'plataforma' ? '' : (id ?? ''); }

  /** Lo que ve quien paga. El archivo subido gana siempre; si no hay, el dato antiguo solo sirve de respaldo de lectura. */
  async ver(ambito: AmbitoQr, id?: string): Promise<QrVista> {
    const prop = this.propietario(ambito, id);
    const f = (await this.bd.execute(sql`SELECT id::text AS id, banco FROM kyros_qr_cobro WHERE ambito = ${ambito} AND propietario_id = ${prop}`)).rows[0] as { id: string; banco: string | null } | undefined;
    if (f) return { url: `${RUTA_PUBLICA}/${f.id}`, banco: f.banco, esRespaldo: false };
    // El cliente (sucursal) nunca tuvo un QR propio antes de este cambio: no hay dato antiguo que mostrar.
    return ambito === 'plataforma' ? this.respaldoPlataforma() : { url: null, banco: null, esRespaldo: false };
  }

  /**
   * platform_settings.payment_qr_url guardaba el QR de la plataforma: normalmente la clave de un archivo ya subido al almacenamiento y, en datos
   * muy viejos, una URL. Una URL válida se sirve como respaldo; un archivo se IMPORTA una vez a kyros_qr_cobro (queda ya como archivo subido).
   */
  private async respaldoPlataforma(): Promise<QrVista> {
    const [c] = (await this.bd.execute(sql`SELECT payment_qr_url AS url FROM platform_settings WHERE id = 1`)).rows as { url: string | null }[];
    if (!c?.url) return { url: null, banco: null, esRespaldo: false };
    const externa = urlQrAntiguaValida(c.url);
    if (externa) return { url: externa, banco: null, esRespaldo: true };
    try {
      const img = validarYLimpiarQr(await this.storage.leer(c.url));
      await this.bd.execute(sql`INSERT INTO kyros_qr_cobro (ambito, propietario_id, mime, contenido, bytes, ancho, alto, subido_por)
        VALUES ('plataforma', '', ${img.mime}, ${img.bytes}, ${img.bytes.length}, ${img.ancho}, ${img.alto}, 'migracion') ON CONFLICT (ambito, propietario_id) DO NOTHING`);
      const f = (await this.bd.execute(sql`SELECT id::text AS id FROM kyros_qr_cobro WHERE ambito = 'plataforma' AND propietario_id = ''`)).rows[0] as { id: string } | undefined;
      return f ? { url: `${RUTA_PUBLICA}/${f.id}`, banco: null, esRespaldo: false } : { url: null, banco: null, esRespaldo: false };
    } catch { return { url: null, banco: null, esRespaldo: false }; }
  }

  /** ¿Hay QR de la plataforma (archivo o dato antiguo)? Para el indicador `tieneQr` de la suscripción; no importa nada. */
  async hayPlataforma(): Promise<boolean> {
    if ((await this.bd.execute(sql`SELECT 1 FROM kyros_qr_cobro WHERE ambito = 'plataforma' AND propietario_id = ''`)).rows.length) return true;
    return (await this.bd.execute(sql`SELECT 1 FROM platform_settings WHERE id = 1 AND payment_qr_url IS NOT NULL`)).rows.length > 0;
  }

  /** Sirve la imagen guardada (solo lectura, id UUID). 304 si el ETag coincide. */
  async servir(id: string, ifNoneMatch?: string): Promise<{ estado: 200 | 304; cabeceras: Record<string, string>; cuerpo?: Buffer }> {
    if (!UUID.test(id)) throw new NotFoundException();
    const f = (await this.bd.execute(sql`SELECT mime, contenido, bytes FROM kyros_qr_cobro WHERE id = ${id}::uuid`)).rows[0] as { mime: MimeQr; contenido: Buffer; bytes: number } | undefined;
    if (!f) throw new NotFoundException();
    const etag = `"${createHash('sha256').update(id).digest('hex').slice(0, 32)}"`; // el contenido de un id nunca cambia: reemplazar crea otro id
    const cab = cabecerasServirQr(f.mime, f.bytes, etag);
    if (ifNoneMatch && ifNoneMatch.split(',').map((x) => x.trim().replace(/^W\//, '')).includes(etag)) { delete cab['Content-Length']; return { estado: 304, cabeceras: cab }; }
    return { estado: 200, cabeceras: cab, cuerpo: f.contenido };
  }

  /** Sube o reemplaza (transacción: borra + inserta, id nuevo). `clienteId` solo en el ámbito cliente. */
  async guardar(ambito: AmbitoQr, quien: string, archivo: Buffer | undefined, banco: unknown, clienteId?: string): Promise<QrVista & { reemplazo: boolean }> {
    let img;
    try { img = validarYLimpiarQr(archivo); } catch (e) { throw deErrorQr(e); }
    const prop = this.propietario(ambito, clienteId);
    await this.limitar(quien);
    const bancoLimpio = limpiarBancoQr(banco);
    const r = await this.bd.transaction(async (tx) => {
      const antes = (await tx.execute(sql`DELETE FROM kyros_qr_cobro WHERE ambito = ${ambito} AND propietario_id = ${prop} RETURNING id::text AS id`)).rows[0] as { id: string } | undefined;
      const nuevo = (await tx.execute(sql`INSERT INTO kyros_qr_cobro (ambito, propietario_id, mime, contenido, bytes, ancho, alto, banco, subido_por)
        VALUES (${ambito}, ${prop}, ${img.mime}, ${img.bytes}, ${img.bytes.length}, ${img.ancho}, ${img.alto}, ${bancoLimpio}, ${quien}) RETURNING id::text AS id`)).rows[0] as { id: string };
      await this.auditar(tx as unknown as Bd, antes ? 'qr_cobro.reemplazar' : 'qr_cobro.subir', quien, ambito, clienteId, nuevo.id, { ambito, clienteId: clienteId ?? null, idAnterior: antes?.id ?? null, mime: img.mime, bytes: img.bytes.length, banco: bancoLimpio });
      return { id: nuevo.id, reemplazo: !!antes };
    });
    return { url: `${RUTA_PUBLICA}/${r.id}`, banco: bancoLimpio, esRespaldo: false, reemplazo: r.reemplazo };
  }

  async quitar(ambito: AmbitoQr, quien: string, clienteId?: string): Promise<{ ok: true }> {
    const prop = this.propietario(ambito, clienteId);
    await this.limitar(quien);
    await this.bd.transaction(async (tx) => {
      const antes = (await tx.execute(sql`DELETE FROM kyros_qr_cobro WHERE ambito = ${ambito} AND propietario_id = ${prop} RETURNING id::text AS id`)).rows[0] as { id: string } | undefined;
      if (!antes) throw new NotFoundException('No hay un QR para quitar.');
      // «Quitar» también apaga el dato antiguo: si no, el respaldo volvería a mostrar el QR viejo.
      if (ambito === 'plataforma') await tx.execute(sql`UPDATE platform_settings SET payment_qr_url = NULL WHERE id = 1`);
      await this.auditar(tx as unknown as Bd, 'qr_cobro.quitar', quien, ambito, clienteId, antes.id, { ambito, clienteId: clienteId ?? null, idAnterior: antes.id });
    });
    return { ok: true };
  }

  /** Cuota: como máximo 20 cambios por hora por persona (el sistema no tenía un mecanismo de cuotas aplicable). */
  private async limitar(quien: string) {
    const n = Number(((await this.bd.execute(sql`SELECT count(*)::int AS n FROM audit_log WHERE user_id = ${quien}::uuid AND action LIKE 'qr_cobro.%' AND created_at > now() - interval '1 hour'`)).rows[0] as { n: number }).n);
    if (n >= MAX_CAMBIOS_POR_HORA) throw errorHttpQr('limite', 'Hiciste demasiados cambios seguidos. Espera un rato e inténtalo de nuevo.', 429);
  }

  private auditar(tx: Bd, accion: string, quien: string, ambito: AmbitoQr, clienteId: string | undefined, entidad: string, despues: unknown) {
    return tx.execute(sql`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after)
      VALUES (${ambito === 'cliente' ? clienteId! : null}::uuid, ${quien}::uuid, ${accion}, 'kyros_qr_cobro', ${entidad}, ${JSON.stringify(despues)}::jsonb)`);
  }
}
