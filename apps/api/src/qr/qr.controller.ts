import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UnauthorizedException, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { Actor, ActorActual, Publico, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import { BD, Bd, Tenant } from '../database/database.module';
import { restaurantTables } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';
import { huellaQr } from '../tiempo-real/eventos.gateway';
import { AgregarItems, PedidosService } from '../pedidos/pedidos.service';
import { NuevaSolicitud, SesionMesa, SolicitudesService, type MesaCtx } from './solicitudes.service';

type ConMesa = Request & { mesa?: MesaCtx };

/** TableTokenGuard: JWT de mesa (aud "table") válido, mesa activa y QR vigente. Un token de personal NO sirve aquí. */
@Injectable()
export class TableTokenGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService, @Inject(SecretosService) private readonly secretos: SecretosService, @Inject(BD) private readonly bd: Bd) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ConMesa>();
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const p = await this.jwt.verifyAsync<{ rid: string; tid: string; qk: string }>(token, { secret: this.secretos.firma('mesa'), algorithms: ['HS256'], audience: 'table' }).catch(() => null);
    if (!p) throw new UnauthorizedException('QR vencido: vuelve a escanear.');
    const [m] = await this.bd.select({ activa: restaurantTables.active, rid: restaurantTables.restaurantId, qr: restaurantTables.qrToken }).from(restaurantTables).where(eq(restaurantTables.id, p.tid));
    if (!m || !m.activa || m.rid !== p.rid || huellaQr(m.qr) !== p.qk) throw new ForbiddenException('Mesa no disponible.');
    req.mesa = { restaurantId: p.rid, tableId: p.tid };
    return true;
  }
}

/** El cliente de mesa no instala nada: escanea el QR, recibe un token de 4 h y pide atención. */
@Controller('qr')
export class QrController {
  constructor(@Inject(SolicitudesService) private readonly s: SolicitudesService, @Inject(PedidosService) private readonly p: PedidosService) {}

  @Publico() @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Post('sesion') @HttpCode(200)
  sesion(@Body() b: unknown) { return this.s.abrirSesion(SesionMesa.parse(b).qrToken); }

  @Publico() @UseGuards(TableTokenGuard) @Throttle({ default: { limit: 12, ttl: 60_000 } }) @Post('solicitudes')
  solicitar(@Req() req: ConMesa, @Body() b: unknown) { return this.s.crear(req.mesa!, NuevaSolicitud.parse(b)); }

  /** Pedido del cliente por QR (opcional por sucursal): entra al pedido abierto de la mesa. */
  @Publico() @UseGuards(TableTokenGuard) @Throttle({ default: { limit: 6, ttl: 60_000 } }) @Post('pedidos') @HttpCode(200)
  pedir(@Req() req: ConMesa, @Body() b: unknown) {
    const d = z.object({ comentario: z.string().trim().max(300).optional() }).passthrough().parse(b);
    return this.p.desdeQr(req.mesa!.restaurantId, req.mesa!.tableId, AgregarItems.parse({ items: (b as { items?: unknown }).items }), d.comentario);
  }

  /** Mi pedido: sus platos y el avance de cada uno (por confirmar, enviado, en preparación, listo). */
  @Publico() @UseGuards(TableTokenGuard) @Get('pedido')
  miPedido(@Req() req: ConMesa) { return this.p.deMesa(req.mesa!.restaurantId, req.mesa!.tableId); }

  @Publico() @UseGuards(TableTokenGuard) @Get('estado')
  estado(@Req() req: ConMesa) { return this.s.estadoDeMesa(req.mesa!); }
}

const Estado = z.enum(['pendiente', 'atendida', 'todas']).default('pendiente');

@Controller('solicitudes')
export class SolicitudesController {
  constructor(@Inject(SolicitudesService) private readonly s: SolicitudesService) {}

  @Get() @DeSucursal()
  listar(@TenantActual() t: Tenant, @Query('estado') estado?: string) { return this.s.listar(t, Estado.parse(estado)); }

  @Post(':id/atender') @HttpCode(200) @DeSucursal('owner', 'admin', 'mesero', 'area_manager', 'cajero')
  atender(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.atender(t, a.sub, id); }
}
