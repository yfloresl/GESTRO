import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Response } from 'express';
import type { Rol, SesionRespuesta } from '@gestro/contracts';
import { entorno } from '../config/entorno';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { BD, Bd } from '../database/database.module';
import { kyrosLinks, refreshTokens, restaurants, roles, userRoles, users } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';

export const COOKIE_REFRESCO = 'gestro_rt';
const VIDA_REFRESCO_MS = 14 * 86_400_000;
const VIDA_ACCESO = '15m';
/** Dos pestañas pueden refrescar a la vez: un refresco usado hace menos de esto no se toma por robo. */
const GRACIA_REUSO_MS = 10_000;

/** Sesión propia de GESTRO: acceso de 15 min en memoria, refresco opaco y rotativo en cookie HttpOnly. */
@Injectable()
export class SesionService {
  constructor(
    @Inject(BD) private readonly bd: Bd,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(SecretosService) private readonly secretos: SecretosService,
    @Inject(ConfiguracionService) private readonly config: ConfiguracionService,
  ) {}

  /** Interruptor del SuperAdmin central (apagado por defecto): si está apagado, las sesiones centrales no se renuevan. */
  async centralEncendido(): Promise<boolean> {
    return !!(await this.config.leer<{ plataformaSso?: boolean }>('kyrosId'))?.plataformaSso;
  }

  /** Sucursales y roles del usuario. Salen siempre de GESTRO, nunca de claims del emisor. */
  async contexto(userId: string) {
    const [u] = await this.bd.select().from(users).where(and(eq(users.id, userId), eq(users.active, true)));
    if (!u) throw new UnauthorizedException('Cuenta no disponible');
    const filas = await this.bd.select({ rid: restaurants.id, nombre: restaurants.name, rol: roles.code })
      .from(userRoles)
      .innerJoin(restaurants, eq(restaurants.id, userRoles.restaurantId))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), inArray(restaurants.status, ['activo', 'suspendido'])));
    const mapa = new Map<string, { id: string; nombre: string; roles: Rol[] }>();
    for (const f of filas) {
      const s = mapa.get(f.rid) ?? { id: f.rid, nombre: f.nombre, roles: [] };
      s.roles.push(f.rol as Rol);
      mapa.set(f.rid, s);
    }
    return { usuario: u, sucursales: [...mapa.values()] };
  }

  /** `central`: la sesión nació de un claim kyros_pa vigente; el privilegio es del claim, nunca de la fila (no se persiste). */
  private async respuesta(userId: string, central = false): Promise<SesionRespuesta> {
    const { usuario, sucursales } = await this.contexto(userId);
    const plat = usuario.isPlatformAdmin || central;
    const accessToken = await this.jwt.signAsync(
      { plat, rids: sucursales.map((s) => s.id), roles: Object.fromEntries(sucursales.map((s) => [s.id, s.roles])) },
      { secret: this.secretos.firma('acceso'), algorithm: 'HS256', audience: 'staff', subject: usuario.id, expiresIn: VIDA_ACCESO },
    );
    return { accessToken, usuario: { id: usuario.id, nombre: usuario.fullName, esPlataforma: plat }, sucursales };
  }

  private poner(res: Response, token: string, vence?: Date) {
    res.cookie(COOKIE_REFRESCO, token, {
      httpOnly: true, secure: entorno.produccion, sameSite: 'strict', path: '/api/v1/auth', maxAge: vence ? Math.max(0, vence.getTime() - Date.now()) : VIDA_REFRESCO_MS,
    });
  }

  /** Abre una sesión nueva (una familia de refresco nueva). */
  async abrir(userId: string, kyrosSub: string | null, ip: string, res: Response, centralHasta?: Date): Promise<SesionRespuesta> {
    const token = this.secretos.tokenAleatorio();
    const vence = new Date(Math.min(Date.now() + VIDA_REFRESCO_MS, centralHasta?.getTime() ?? Infinity));
    await this.bd.insert(refreshTokens).values({
      userId, tokenHash: this.secretos.huella(token), expiresAt: vence, kyrosSub, ip: ip || null, centralHasta: centralHasta ?? null,
    });
    this.poner(res, token, vence);
    return this.respuesta(userId, !!centralHasta);
  }

  /**
   * Rota el refresco: cada uso invalida el anterior. Reutilizar uno ya usado indica robo y revoca
   * TODA la familia de esa sesión.
   */
  async refrescar(token: string | undefined, ip: string, res: Response): Promise<SesionRespuesta> {
    if (!token) throw new UnauthorizedException('Sesión requerida');
    const hash = this.secretos.huella(token);
    const [fila] = await this.bd.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash));
    if (!fila || fila.revokedAt || fila.expiresAt.getTime() < Date.now()) throw new UnauthorizedException('Sesión vencida');
    if (fila.usedAt) {
      // Carrera legítima (dos pestañas): se rechaza sin revocar. Fuera de la ventana es reutilización = robo.
      if (Date.now() - fila.usedAt.getTime() < GRACIA_REUSO_MS) throw new UnauthorizedException('Sesión vencida');
      await this.bd.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, fila.familyId), isNull(refreshTokens.revokedAt)));
      throw new UnauthorizedException('Sesión vencida');
    }
    // Sesión central: tope absoluto de 60 min, interruptor encendido y vínculo de plataforma vigente. Si algo falla, se corta la familia.
    if (fila.centralHasta) {
      const [v] = await this.bd.select({ o: kyrosLinks.origen }).from(kyrosLinks).where(eq(kyrosLinks.userId, fila.userId));
      if (fila.centralHasta.getTime() <= Date.now() || !(await this.centralEncendido()) || v?.o !== 'PLATAFORMA') {
        await this.bd.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, fila.familyId), isNull(refreshTokens.revokedAt)));
        await this.bd.execute(sql`INSERT INTO audit_log (user_id, action, entity, entity_id, after) VALUES (${fila.userId}::uuid, 'plataforma.sesion_central_revocada', 'user', ${fila.userId}::text, ${JSON.stringify({ motivo: fila.centralHasta.getTime() <= Date.now() ? 'tope' : 'interruptor_o_vinculo' })}::jsonb)`);
        throw new UnauthorizedException('Sesión vencida');
      }
    }
    // Marcar como usado de forma atómica: si dos pestañas lo usan a la vez, solo una gana.
    const gana = await this.bd.update(refreshTokens).set({ usedAt: new Date() })
      .where(and(eq(refreshTokens.id, fila.id), isNull(refreshTokens.usedAt))).returning({ id: refreshTokens.id });
    if (!gana.length) throw new UnauthorizedException('Sesión vencida');
    const nuevo = this.secretos.tokenAleatorio();
    const vence = new Date(Math.min(Date.now() + VIDA_REFRESCO_MS, fila.centralHasta?.getTime() ?? Infinity));
    await this.bd.insert(refreshTokens).values({
      userId: fila.userId, tokenHash: this.secretos.huella(nuevo), expiresAt: vence,
      familyId: fila.familyId, kyrosSub: fila.kyrosSub, ip: ip || null, centralHasta: fila.centralHasta,
    });
    this.poner(res, nuevo, vence);
    return this.respuesta(fila.userId, !!fila.centralHasta);
  }

  async salir(token: string | undefined, res: Response): Promise<void> {
    if (token) {
      const [fila] = await this.bd.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, this.secretos.huella(token)));
      if (fila) await this.bd.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, fila.familyId), isNull(refreshTokens.revokedAt)));
    }
    res.clearCookie(COOKIE_REFRESCO, { path: '/api/v1/auth' });
  }

  /** Cierre global (back-channel logout de Kyros ID): revoca todas las sesiones de ese `sub`. */
  async revocarPorSub(sub: string): Promise<number> {
    const r = await this.bd.update(refreshTokens).set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.kyrosSub, sub), isNull(refreshTokens.revokedAt))).returning({ id: refreshTokens.id });
    return r.length;
  }

  yo(userId: string): Promise<SesionRespuesta> {
    return this.respuesta(userId);
  }
}
