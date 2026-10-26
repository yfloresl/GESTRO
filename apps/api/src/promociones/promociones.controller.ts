import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Activar, NuevaPromocion, PromocionesService } from './promociones.service';

const ADMIN = ['owner', 'admin'] as const;
const LEE = ['owner', 'admin', 'contador', 'area_manager', 'cajero'] as const;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const dia = (d: number) => new Date(Date.now() - 4 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);

/** Promociones del restaurante: descuentos por porcentaje o precio fijo, por fechas, días y horario (happy hour). */
@Controller('promociones')
export class PromocionesController {
  constructor(@Inject(PromocionesService) private readonly p: PromocionesService) {}

  @Get() @DeSucursal(...LEE)
  lista(@TenantActual() t: Tenant) { return this.p.lista(t); }
  @Get('uso') @DeSucursal(...ADMIN, 'contador')
  uso(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) {
    const desde = d ?? dia(-29); const hasta = h ?? dia(0);
    if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) throw new BadRequestException('Fechas con formato AAAA-MM-DD.');
    return this.p.uso(t, desde, hasta);
  }
  @Post() @DeSucursal(...ADMIN)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.p.crear(t, a.sub, NuevaPromocion.parse(b)); }
  @Put(':id') @DeSucursal(...ADMIN)
  cambiar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.p.cambiar(t, a.sub, id, NuevaPromocion.parse(b)); }
  @Post(':id/activa') @HttpCode(200) @DeSucursal(...ADMIN)
  activar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.p.activar(t, a.sub, id, Activar.parse(b)); }
  @Delete(':id') @DeSucursal(...ADMIN)
  borrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.p.borrar(t, a.sub, id); }
}
