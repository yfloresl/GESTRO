import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import type { Rol, SesionRespuesta } from '@gestro/contracts';
import { entorno } from '../config/entorno';
import { BD, Bd } from '../database/database.module';
import { refreshTokens, restaurants, roles, userRoles, users } from '../database/esquema';
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
  ) {}

  /** Sucursales y roles del usuario. Salen siempre de GESTRO, nunca de claims del emisor. */
  private async contexto(userId: string) {
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

  private async respuesta(userId: string): Promise<SesionRespuesta> {
    const { usuario, sucursales } = await this.contexto(userId);
    const accessToken = await this.jwt.signAsync(
      { plat: usuario.isPlatformAdmin, rids: sucursales.map((s) => s.id), roles: Object.fromEntries(sucursales.map((s) => [s.id, s.roles])) },
      { secret: this.secretos.firma('acceso'), algorithm: 'HS256', audience: 'staff', subject: usuario.id, expiresIn: VIDA_ACCESO },
    );
    return { accessToken, usuario: { id: usuario.id, nombre: usuario.fullName, esPlataforma: usuario.isPlatformAdmin }, sucursales };
  }

  private poner(res: Response, token: string) {
    res.cookie(COOKIE_REFRESCO, token, {
      httpOnly: true, secure: entorno.produccion, sameSite: 'strict', path: '/api/v1/auth', maxAge: VIDA_REFRESCO_MS,
    });
  }

  /** Abre una sesión nueva (una familia de refresco nueva). */
  async abrir(userId: string, kyrosSub: string | null, ip: string, res: Response): Promise<SesionRespuesta> {
    const token = this.secretos.tokenAleatorio();
    await this.bd.insert(refreshTokens).values({
      userId, tokenHash: this.secretos.huella(token), expiresAt: new Date(Date.now() + VIDA_REFRESCO_MS), kyrosSub, ip: ip || null,
    });
    this.poner(res, token);
    return this.respuesta(userId);
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
    // Marcar como usado de forma atómica: si dos pestañas lo usan a la vez, solo una gana.
    const gana = await this.bd.update(refreshTokens).set({ usedAt: new Date() })
      .where(and(eq(refreshTokens.id, fila.id), isNull(refreshTokens.usedAt))).returning({ id: refreshTokens.id });
    if (!gana.length) throw new UnauthorizedException('Sesión vencida');
    const nuevo = this.secretos.tokenAleatorio();
    await this.bd.insert(refreshTokens).values({
      userId: fila.userId, tokenHash: this.secretos.huella(nuevo), expiresAt: new Date(Date.now() + VIDA_REFRESCO_MS),
      familyId: fila.familyId, kyrosSub: fila.kyrosSub, ip: ip || null,
    });
    this.poner(res, nuevo);
    return this.respuesta(fila.userId);
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
