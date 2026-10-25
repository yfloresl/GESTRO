import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Rol } from '@gestro/contracts';
import type { Tenant } from '../database/database.module';

export const PUBLICO = 'gestro:publico';
export const ROLES_KEY = 'gestro:roles';
export const CONSOLIDADO_KEY = 'gestro:consolidado';

/** Endpoint sin sesión de personal (ingreso, salud, menú público). */
export const Publico = () => SetMetadata(PUBLICO, true);
/** Roles que pueden usar el endpoint en la sucursal activa. 'plataforma' = personal de Kyros-Tech. */
export const Roles = (...r: (Rol | 'plataforma')[]) => SetMetadata(ROLES_KEY, r);
/** Solo los endpoints marcados ven todas las sucursales del token (por defecto, UNA). */
export const Consolidated = () => SetMetadata(CONSOLIDADO_KEY, true);

/** Claims del token de acceso del personal (aud: "staff"). */
export interface Actor {
  sub: string;
  plat: boolean;
  rids: string[];
  roles: Record<string, Rol[]>;
}

export type PeticionAutenticada = Request & { actor?: Actor; tenant?: Tenant };

export const ActorActual = createParamDecorator((_d, ctx: ExecutionContext): Actor => ctx.switchToHttp().getRequest<PeticionAutenticada>().actor!);
export const TenantActual = createParamDecorator((_d, ctx: ExecutionContext): Tenant => ctx.switchToHttp().getRequest<PeticionAutenticada>().tenant!);

export const ipDe = (req: Request): string => (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
