import { applyDecorators, CanActivate, ExecutionContext, UseGuards, ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { SetMetadata } from '@nestjs/common';
import { BD, Bd } from '../database/database.module';
import { restaurants } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';
import type { Rol } from '@gestro/contracts';
import { Actor, CONSOLIDADO_KEY, PeticionAutenticada, PUBLICO, Roles, ROLES_KEY } from './acceso';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(BD) private readonly bd: Bd) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    const rid = req.headers['x-restaurant-id'];
    const actor = req.actor;
    if (!actor || typeof rid !== 'string') throw new ForbiddenException('Sucursal no autorizada');
    // El equipo de plataforma puede entrar a cualquier sucursal en MODO SOPORTE: ve todo (como dueño) pero no escribe nada.
    const soporte = !actor.rids.includes(rid) && actor.plat && UUID.test(rid);
    if (!soporte && !actor.rids.includes(rid)) throw new ForbiddenException('Sucursal no autorizada');
    if (soporte) {
      const [r] = await this.bd.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, rid));
      if (!r) throw new ForbiddenException('Sucursal no autorizada');
      req.soporte = true; req.tenant = { restaurantId: rid, restaurantIds: [] }; return true;
    }
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
    const propios = req.soporte ? ['owner'] : (actor.roles[tenant.restaurantId] ?? []);
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

/** Endpoints que SÍ pueden usarse en la sucursal de demostración (que es de solo lectura). */
export const PERMITE_EN_DEMO = 'gestro:permite-en-demo';
export const PermiteEnDemo = () => SetMetadata(PERMITE_EN_DEMO, true);

/** La sucursal de demostración es de solo lectura: cualquier escritura devuelve 403, salvo los endpoints marcados con @PermiteEnDemo. */
@Injectable()
export class DemoSoloLecturaGuard implements CanActivate {
  constructor(@Inject(BD) private readonly bd: Bd, @Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.tenant) return true;
    if (req.soporte) throw new ForbiddenException('Modo de soporte: solo lectura. El equipo de plataforma puede mirar la sucursal, no modificarla.');   // antes de cualquier excepción
    if (this.reflector.get<boolean>(PERMITE_EN_DEMO, ctx.getHandler()) === true) return true;
    const [r] = await this.bd.select({ demo: restaurants.isDemo }).from(restaurants).where(eq(restaurants.id, req.tenant.restaurantId));
    if (r?.demo) throw new ForbiddenException('Esta cuenta es solo de lectura: puedes recorrer todo, pero no modificar los datos de muestra.');
    return true;
  }
}

/** Pagar la suscripción debe poder hacerse justo cuando la sucursal venció (modo solo lectura). */
export const DeSucursalSiempre = (...roles: (Rol | 'plataforma')[]) =>
  applyDecorators(Roles(...roles), UseGuards(RestaurantScopeGuard, RolesGuard, DemoSoloLecturaGuard));

/** Consola de Kyros-Tech: solo personal de plataforma (no depende de ninguna sucursal). */
@Injectable()
export class SoloPlataformaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const actor = ctx.switchToHttp().getRequest<PeticionAutenticada>().actor;
    if (!actor?.plat) throw new ForbiddenException('Solo para el equipo de plataforma.');
    return true;
  }
}
export const SoloPlataforma = () => UseGuards(SoloPlataformaGuard);

/** Endpoint de una sucursal: valida X-Restaurant-Id, el rol y que la suscripción permita escribir. */
export const DeSucursal = (...roles: (Rol | 'plataforma')[]) =>
  applyDecorators(Roles(...roles), UseGuards(RestaurantScopeGuard, RolesGuard, DemoSoloLecturaGuard, SubscriptionGuard));
