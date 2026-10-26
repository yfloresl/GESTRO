import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Actor, ActorActual, Publico, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Accion, AjustesReservas, Cancelar, Fecha, MoverMesa, ReservaDelPersonal, ReservaPublica, ReservasService } from './reservas.service';

const SALON = ['owner', 'admin', 'mesero', 'cajero', 'area_manager'] as const;
const hoyLaPaz = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const fecha = (f?: string) => { const r = Fecha.safeParse(f ?? hoyLaPaz()); if (!r.success) throw new BadRequestException('Fecha con formato AAAA-MM-DD.'); return r.data; };

/** Gestión de reservas por el personal de la sucursal. */
@Controller('reservas')
export class ReservasController {
  constructor(@Inject(ReservasService) private readonly r: ReservasService) {}

  @Get('ajustes') @DeSucursal(...SALON)
  ajustes(@TenantActual() t: Tenant) { return this.r.ajustes(t); }
  @Put('ajustes') @DeSucursal('owner', 'admin')
  cambiarAjustes(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.r.cambiarAjustes(t, a.sub, AjustesReservas.parse(b)); }

  @Get() @DeSucursal(...SALON)
  dia(@TenantActual() t: Tenant, @Query('fecha') f?: string) { return this.r.dia(t, fecha(f)); }
  @Post() @DeSucursal(...SALON)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.r.crear(t, a.sub, ReservaDelPersonal.parse(b)); }
  @Post(':id/estado') @HttpCode(200) @DeSucursal(...SALON)
  estado(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.r.cambiarEstado(t, a.sub, id, Accion.parse(b)); }
  @Patch(':id/mesa') @DeSucursal(...SALON)
  mesa(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.r.moverMesa(t, a.sub, id, MoverMesa.parse(b)); }
}

/** Reservas desde la web pública del restaurante (sin sesión). */
@Controller('public/:slug/reservas')
export class ReservasPublicasController {
  constructor(@Inject(ReservasService) private readonly r: ReservasService) {}

  @Publico() @Get()
  info(@Param('slug') slug: string) { return this.r.publica(slug); }
  @Publico() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Get('disponibilidad')
  disponibilidad(@Param('slug') slug: string, @Query('fecha') f?: string, @Query('personas') p?: string) {
    const n = Number(p ?? 2);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new BadRequestException('Indica cuántas personas son.');
    return this.r.disponibilidad(slug, fecha(f), n);
  }
  @Publico() @Throttle({ default: { limit: 6, ttl: 60_000 } }) @Post()
  reservar(@Param('slug') slug: string, @Body() b: unknown) { return this.r.reservar(slug, ReservaPublica.parse(b)); }
  @Publico() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('cancelar') @HttpCode(200)
  cancelar(@Param('slug') slug: string, @Body() b: unknown) { return this.r.cancelarPublica(slug, Cancelar.parse(b).codigo); }
}
