import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Area, Asignacion, Mesa, MesaParcial, SalonService } from './salon.service';

const EDITA = ['owner', 'admin'] as const;

@Controller()
export class SalonController {
  constructor(@Inject(SalonService) private readonly salon: SalonService) {}

  @Get('areas') @DeSucursal()
  areas(@TenantActual() t: Tenant) { return this.salon.areas(t); }
  @Post('areas') @DeSucursal(...EDITA)
  crearArea(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.salon.crearArea(t, a.sub, Area.parse(b)); }
  @Patch('areas/:id') @DeSucursal(...EDITA)
  cambiarArea(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.salon.cambiarArea(t, a.sub, id, Area.parse(b)); }

  @Get('mesas') @DeSucursal()
  mesas(@TenantActual() t: Tenant, @ActorActual() a: Actor) {
    const conQr = (a.roles[t.restaurantId] ?? []).some((r) => r === 'owner' || r === 'admin');
    return this.salon.mesas(t, conQr);
  }
  @Post('mesas') @DeSucursal(...EDITA)
  crearMesa(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.salon.crearMesa(t, a.sub, Mesa.parse(b)); }
  @Patch('mesas/:id') @DeSucursal(...EDITA)
  cambiarMesa(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.salon.cambiarMesa(t, a.sub, id, MesaParcial.parse(b)); }
  @Post('mesas/:id/qr/regenerar') @HttpCode(200) @DeSucursal(...EDITA)
  regenerar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.salon.regenerarQr(t, a.sub, id); }

  @Get('asignaciones') @DeSucursal()
  asignaciones(@TenantActual() t: Tenant) { return this.salon.asignaciones(t); }
  @Put('asignaciones') @DeSucursal(...EDITA, 'area_manager')
  asignar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.salon.asignar(t, a.sub, Asignacion.parse(b)); }
}
