import { applyDecorators, CanActivate, ExecutionContext, UseGuards, ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { BD, Bd } from '../database/database.module';
import { restaurants } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';
import type { Rol } from '@gestro/contracts';
import { Actor, CONSOLIDADO_KEY, PeticionAutenticada, PUBLICO, Roles, ROLES_KEY } from './acceso';

/** Días de gracia después de paid_until antes de pasar a solo lectura (provisional: configurable luego). */
export const DIAS_DE_GRACIA = 3;

/** JwtAuthGuard (global): firma, expiración y aud "staff". Toda la API de personal lo exige. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(SecretosService) private readonly secretos: SecretosService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Sesión requerida');
    try {
      const p = await this.jwt.verifyAsync<Actor & { aud: string }>(token, {
        secret: this.secretos.firma('acceso'), algorithms: ['HS256'], audience: 'staff',
      });
      req.actor = { sub: p.sub, plat: !!p.plat, rids: p.rids ?? [], roles: p.roles ?? {} };
      return true;
    } catch {
      throw new UnauthorizedException('Sesión vencida');
    }
  }
}

/** X-Restaurant-Id debe estar entre las sucursales del token. Fija el contexto de sucursal. */
@Injectable()
export class RestaurantScopeGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    const rid = req.headers['x-restaurant-id'];
    const actor = req.actor;
    if (!actor || typeof rid !== 'string' || !actor.rids.includes(rid)) throw new ForbiddenException('Sucursal no autorizada');
    const consolidado = this.reflector.get<boolean>(CONSOLIDADO_KEY, ctx.getHandler()) === true;
    // Por defecto la consulta ve UNA sola sucursal; solo @Consolidated() recibe todas las del token.
    req.tenant = { restaurantId: rid, restaurantIds: consolidado ? actor.rids : [] };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requeridos = this.reflector.get<string[] | undefined>(ROLES_KEY, ctx.getHandler()) ?? [];
    if (!requeridos.length) return true;
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    const { actor, tenant } = req;
    if (!actor || !tenant) throw new ForbiddenException('Sin permiso');
    if (requeridos.includes('plataforma') && actor.plat) return true;
    const propios = actor.roles[tenant.restaurantId] ?? [];
    if (!propios.some((r) => requeridos.includes(r))) throw new ForbiddenException('Sin permiso en esta sucursal');
    return true;
  }
}

/** Sucursal vencida: lectura siempre permitida; escribir devuelve 402. */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(@Inject(BD) private readonly bd: Bd) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const [r] = await this.bd.select({ paidUntil: restaurants.paidUntil, status: restaurants.status })
      .from(restaurants).where(eq(restaurants.id, req.tenant!.restaurantId));
    const limite = r?.paidUntil ? new Date(`${r.paidUntil}T23:59:59-04:00`).getTime() + DIAS_DE_GRACIA * 86_400_000 : 0;
    if (!r || r.status !== 'activo' || Date.now() > limite) {
      throw new HttpException({ code: 'SUBSCRIPTION_EXPIRED', message: 'Suscripción vencida: el sistema está en modo solo lectura' }, 402);
    }
    return true;
  }
}

/** Endpoint de una sucursal: valida X-Restaurant-Id, el rol y que la suscripción permita escribir. */
export const DeSucursal = (...roles: (Rol | 'plataforma')[]) =>
  applyDecorators(Roles(...roles), UseGuards(RestaurantScopeGuard, RolesGuard, SubscriptionGuard));
