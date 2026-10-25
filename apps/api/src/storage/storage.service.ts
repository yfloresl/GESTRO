import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { entorno } from '../config/entorno';

/** Tipo de imagen por CONTENIDO (firma), nunca por extensión ni por el Content-Type del cliente. SVG y otros, prohibidos. */
export function tipoDeImagen(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export const MIME_POR_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * Archivos fuera de la base, en el volumen gestro_archivos, con carpeta por sucursal (UUID aleatorio).
 * La base guarda solo la clave. La interfaz es la de un driver: pasar a S3 después no toca a quien la usa.
 */
@Injectable()
export class StorageService {
  private ruta(clave: string): string {
    const base = normalize(entorno.dirArchivos);
    const abs = normalize(join(base, clave));
    if (!abs.startsWith(base + sep)) throw new BadRequestException('Ruta de archivo inválida.');
    return abs;
  }

  async guardarImagen(restaurantId: string, carpeta: 'menu' | 'vouchers', datos: Buffer, maxBytes: number): Promise<string> {
    if (datos.length === 0 || datos.length > maxBytes) throw new BadRequestException(`La imagen debe pesar menos de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const tipo = tipoDeImagen(datos);
    if (!tipo) throw new BadRequestException('Solo se aceptan imágenes JPG, PNG o WebP.');
    const clave = `${restaurantId}/${carpeta}/${randomUUID()}.${tipo.ext}`;
    const destino = this.ruta(clave);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, datos, { mode: 0o600 });
    return clave;
  }

  /** Igual que guardarImagen pero con un prefijo propio (p. ej. el QR de cobro de la plataforma). */
  async guardarImagenEn(prefijo: string, datos: Buffer, maxBytes: number): Promise<string> {
    if (datos.length === 0 || datos.length > maxBytes) throw new BadRequestException(`La imagen debe pesar menos de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const tipo = tipoDeImagen(datos);
    if (!tipo) throw new BadRequestException('Solo se aceptan imágenes JPG, PNG o WebP.');
    const clave = `${prefijo}/${randomUUID()}.${tipo.ext}`;
    const destino = this.ruta(clave);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, datos, { mode: 0o600 });
    return clave;
  }

  leer(clave: string): Promise<Buffer> { return readFile(this.ruta(clave)); }
  async borrar(clave: string): Promise<void> { await rm(this.ruta(clave), { force: true }); }
}
