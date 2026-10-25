import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entorno } from '../config/entorno';

/**
 * Llave maestra. Se genera sola en el primer arranque y vive en el volumen privado de secretos:
 * no está en variables de entorno, ni en el repositorio, ni en la base (un respaldo de la base
 * no la expone). De ella se derivan, con HKDF, la clave de firma de sesión y la que cifra app_config.
 */
@Injectable()
export class SecretosService {
  private readonly maestra: Buffer;

  constructor() {
    const archivo = join(entorno.dirSecretos, 'llave-maestra');
    if (!existsSync(archivo)) {
      mkdirSync(entorno.dirSecretos, { recursive: true, mode: 0o700 });
      writeFileSync(archivo, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
      try { chmodSync(archivo, 0o600); } catch { /* Windows no maneja estos permisos */ }
      new Logger('Secretos').log('Llave maestra generada en el volumen de secretos.');
    }
    this.maestra = Buffer.from(readFileSync(archivo, 'utf8').trim(), 'hex');
    if (this.maestra.length !== 32) throw new Error('La llave maestra está dañada: debe tener 32 bytes.');
  }

  private derivar(uso: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.maestra, Buffer.alloc(0), `gestro:${uso}`, 32));
  }

  /** Clave de firma por tipo de token. Distintas entre sí: un token de un tipo no sirve para otro. */
  firma(uso: 'acceso' | 'mesa' | 'registro-kyros'): string {
    return this.derivar(`firma:${uso}`).toString('hex');
  }

  /** AES-256-GCM. Devuelve iv.etiqueta.dato en base64. */
  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.derivar('configuracion'), iv);
    const dato = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), dato].map((b) => b.toString('base64')).join('.');
  }

  descifrar(cifrado: string): string {
    const [iv, etiqueta, dato] = cifrado.split('.').map((p) => Buffer.from(p, 'base64'));
    const d = createDecipheriv('aes-256-gcm', this.derivar('configuracion'), iv);
    d.setAuthTag(etiqueta);
    return Buffer.concat([d.update(dato), d.final()]).toString('utf8');
  }

  /** Huella de un token de refresco o de un solo uso: en la base nunca se guarda el token. */
  huella(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  tokenAleatorio(): string {
    return randomBytes(32).toString('base64url');
  }
}
