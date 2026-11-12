import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Param, Post, Query, Req, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { Actor, ActorActual, ipDe, Publico } from '../comun/acceso';
import { BD, Bd } from '../database/database.module';
import { esSubDeDemostracion } from '../demo/constantes';
import { TEXTOS_LEGALES } from './textos.generated';

/** Versión vigente de Términos, Privacidad y Políticas. Debe coincidir con la de los textos en docs/legal y apps/web/src/legal (lo verifica una prueba). */
export const VERSION_LEGAL = '2026-11-06';
export const DOCUMENTOS_LEGALES = ['terminos', 'privacidad', 'politicas'] as const;

/** Los campos que se exigen en cada alta (registro de restaurante o unión por código de invitación). */
export const AceptacionSchema = { aceptaTerminos: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los Términos, la Política de privacidad y las Políticas de uso para registrarte.' }) }), versionLegal: z.string().min(4).max(40) };

/** Rechaza el alta si no se aceptó, o si se aceptó una versión que ya no es la vigente. */
export function exigirAceptacion(d: { aceptaTerminos: boolean; versionLegal: string }) {
  if (d.aceptaTerminos !== true) throw new UnprocessableEntityException('Debes aceptar los Términos y la Política de privacidad para registrarte.');
  if (d.versionLegal !== VERSION_LEGAL) throw new UnprocessableEntityException({ code: 'LEGAL_VERSION', message: 'Los términos cambiaron: recarga la página y acepta la versión vigente.', version: VERSION_LEGAL });
}

/** Huella (hash) en vez del dato: sirve de evidencia sin guardar la IP ni el navegador en claro. */
const huella = (v: string | undefined) => (v ? createHash('sha256').update(`gestro-legal:${v}`).digest('hex') : null);

/** Guarda la evidencia dentro de la transacción del alta o de la re-aceptación. */
export async function registrarAceptacion(tx: Pick<Bd, 'execute'>, userId: string, sub: string | null, ip: string, ua: string | undefined, origen: 'registro' | 'reaceptacion') {
  await tx.execute(sql`INSERT INTO legal_acceptances (user_id, kyros_sub, version, documents, origin, ip_hash, ua_hash)
    VALUES (${userId}::uuid, ${sub}, ${VERSION_LEGAL}, ${`{${DOCUMENTOS_LEGALES.join(',')}}`}::text[], ${origen}, ${huella(ip)}, ${huella(ua)}) ON CONFLICT (user_id, version) DO NOTHING`);
}

const TITULOS: Record<string, Record<string, string>> = {
  es: { terminos: 'Términos y condiciones', privacidad: 'Política de privacidad', politicas: 'Políticas de uso' },
  en: { terminos: 'Terms and Conditions', privacidad: 'Privacy Policy', politicas: 'Usage Policies' },
};

const Aceptar = z.object({ acepto: z.literal(true), version: z.string().min(4).max(40) }).strict();

@Injectable()
export class LegalService {
  constructor(@Inject(BD) private readonly bd: Bd) {}

  /** Cuentas de demostración, equipo de plataforma y personal de la sucursal de muestra no pasan por el bloqueo. */
  private async exenta(userId: string): Promise<boolean> {
    const [f] = (await this.bd.execute(sql`SELECT u.is_platform_admin AS plat,
        EXISTS (SELECT 1 FROM user_roles ur JOIN restaurants r ON r.id = ur.restaurant_id WHERE ur.user_id = u.id AND r.is_demo) AS demo,
        COALESCE((SELECT array_agg(sub) FROM kyros_links WHERE user_id = u.id), '{}') AS subs
      FROM users u WHERE u.id = ${userId}::uuid`)).rows as { plat: boolean; demo: boolean; subs: string[] }[];
    return !f || f.plat || f.demo || (f.subs ?? []).some(esSubDeDemostracion);
  }

  async estado(userId: string) {
    if (await this.exenta(userId)) return { version: VERSION_LEGAL, aceptada: true, exenta: true };
    const r = await this.bd.execute(sql`SELECT 1 FROM legal_acceptances WHERE user_id = ${userId}::uuid AND version = ${VERSION_LEGAL}`);
    return { version: VERSION_LEGAL, aceptada: r.rows.length > 0, exenta: false };
  }

  async aceptar(userId: string, d: z.infer<typeof Aceptar>, ip: string, ua: string | undefined) {
    if (d.version !== VERSION_LEGAL) throw new UnprocessableEntityException({ code: 'LEGAL_VERSION', message: 'Los términos cambiaron: recarga la página.', version: VERSION_LEGAL });
    await registrarAceptacion(this.bd, userId, null, ip, ua, 'reaceptacion');
    return { ok: true, version: VERSION_LEGAL };
  }
}

@Controller()
export class LegalController {
  constructor(@Inject(LegalService) private readonly s: LegalService) {}

  /** Versión vigente (pública: la usa el registro y las páginas /terminos, /privacidad, /politicas). */
  @Publico() @Get('public/legal') version() { return { version: VERSION_LEGAL, documentos: DOCUMENTOS_LEGALES }; }

  /** Texto vigente de un documento, SIN sesión: lo lee quien aún no está registrado y los enlaces permanentes (tiendas, Google, Meta). */
  @Publico() @Get('public/legal/:doc/vigente')
  vigente(@Param('doc') doc: string, @Query('idioma') idioma?: string) {
    const i = idioma === 'en' ? 'en' : 'es';
    if (!(DOCUMENTOS_LEGALES as readonly string[]).includes(doc)) throw new NotFoundException('Documento no encontrado.');
    return { documento: doc, titulo: TITULOS[i][doc], version: VERSION_LEGAL, idioma: i, markdown: TEXTOS_LEGALES[`${i}/${doc}`] };
  }

  @Get('legal/estado') estado(@ActorActual() a: Actor) { return this.s.estado(a.sub); }

  @Post('legal/aceptar') @HttpCode(200)
  aceptar(@ActorActual() a: Actor, @Body() b: unknown, @Req() req: Request) {
    return this.s.aceptar(a.sub, Aceptar.parse(b), ipDe(req), req.headers['user-agent']);
  }
}
