import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Accion, CateringService, Cancelacion, CierreDeEvento, CobroDeEvento, MenuDelEvento, NuevoEvento } from './catering.service';

const GESTIONA = ['owner', 'admin'] as const;
const LEE = ['owner', 'admin', 'cocina', 'almacen', 'cajero', 'contador', 'area_manager'] as const;
const COBRA = ['owner', 'admin', 'cajero'] as const;
const INICIA = ['owner', 'admin', 'cocina'] as const;
const ESTADOS = ['cotizado', 'confirmado', 'en_curso', 'cerrado', 'cancelado'];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fecha = (f?: string) => { if (f !== undefined && !FECHA.test(f)) throw new BadRequestException('Fecha con formato AAAA-MM-DD.'); return f; };

/** Eventos y catering: cotización, menú, anticipos, inicio (consume insumos), cierre y cancelación. */
@Controller('eventos')
export class CateringController {
  constructor(@Inject(CateringService) private readonly c: CateringService) {}

  @Get() @DeSucursal(...LEE)
  lista(@TenantActual() t: Tenant, @Query('estado') estado?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    if (estado && !ESTADOS.includes(estado)) throw new BadRequestException('Estado no válido.');
    return this.c.lista(t, { estado, desde: fecha(desde), hasta: fecha(hasta) });
  }
  @Get(':id') @DeSucursal(...LEE)
  detalle(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.c.detalle(t, id); }
  @Post() @DeSucursal(...GESTIONA)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.crear(t, a.sub, NuevoEvento.parse(b)); }
  @Put(':id') @DeSucursal(...GESTIONA)
  cambiar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cambiar(t, a.sub, id, NuevoEvento.parse(b)); }
  @Put(':id/menu') @DeSucursal(...GESTIONA)
  menu(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.menu(t, a.sub, id, MenuDelEvento.parse(b)); }
  @Post(':id/estado') @HttpCode(200) @DeSucursal(...INICIA)
  estado(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const d = Accion.parse(b);
    if (d.accion === 'confirmar' && !(a.roles[t.restaurantId] ?? []).some((r) => GESTIONA.includes(r as 'owner'))) throw new ForbiddenException('Solo dueño o administración confirman un evento.');
    return this.c.cambiarEstado(t, a.sub, id, d);
  }
  @Post(':id/cobros') @HttpCode(200) @DeSucursal(...COBRA)
  cobrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cobrar(t, a.sub, id, CobroDeEvento.parse(b)); }
  @Post(':id/cerrar') @HttpCode(200) @DeSucursal(...GESTIONA)
  cerrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cerrar(t, a.sub, id, CierreDeEvento.parse(b ?? {})); }
  @Post(':id/cancelar') @HttpCode(200) @DeSucursal(...GESTIONA)
  cancelar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cancelar(t, a.sub, id, Cancelacion.parse(b)); }
  @Post(':id/ordenes-de-compra') @HttpCode(200) @DeSucursal('owner', 'admin', 'almacen')
  ordenes(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.c.ordenesDeCompra(t, a.sub, id); }
}
