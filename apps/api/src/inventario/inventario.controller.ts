import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Almacen, Conteo, InventarioService, Insumo, Movimiento, Traspaso } from './inventario.service';

const GESTIONA = ['owner', 'admin', 'almacen'] as const;
const LEE = [...GESTIONA, 'cocina', 'contador'] as const;
const uuidOpc = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/** Inventario y almacenes. El stock solo cambia por movimientos del kardex. */
@Controller()
export class InventarioController {
  constructor(@Inject(InventarioService) private readonly i: InventarioService) {}

  @Get('unidades') @DeSucursal()
  unidades() { return this.i.unidades(); }

  @Get('insumos') @DeSucursal(...LEE)
  insumos(@TenantActual() t: Tenant, @Query('activos') activos?: string) { return this.i.insumos(t, activos === '1'); }
  @Post('insumos') @DeSucursal(...GESTIONA)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.i.crearInsumo(t, a.sub, Insumo.parse(b)); }
  @Patch('insumos/:id') @DeSucursal(...GESTIONA)
  cambiar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.i.cambiarInsumo(t, a.sub, id, Insumo.parse(b)); }
  @Delete('insumos/:id') @DeSucursal(...GESTIONA)
  borrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.i.borrarInsumo(t, a.sub, id); }

  @Get('almacenes') @DeSucursal(...LEE)
  almacenes(@TenantActual() t: Tenant) { return this.i.almacenes(t); }
  @Post('almacenes') @DeSucursal(...GESTIONA)
  crearAlmacen(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.i.crearAlmacen(t, a.sub, Almacen.parse(b)); }
  @Patch('almacenes/:id') @DeSucursal(...GESTIONA)
  cambiarAlmacen(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.i.cambiarAlmacen(t, a.sub, id, Almacen.parse(b)); }

  @Get('stock/niveles') @DeSucursal(...LEE)
  niveles(@TenantActual() t: Tenant, @Query('almacenId') almacenId?: string) { return this.i.niveles(t, uuidOpc(almacenId)); }
  @Get('stock/kardex/:insumoId') @DeSucursal(...LEE)
  kardex(@TenantActual() t: Tenant, @Param('insumoId', ParseUUIDPipe) id: string, @Query('almacenId') almacenId?: string) { return this.i.kardex(t, id, uuidOpc(almacenId)); }
  @Get('stock/alertas') @DeSucursal(...LEE)
  alertas(@TenantActual() t: Tenant) { return this.i.alertas(t); }

  @Post('stock/movimientos') @HttpCode(200) @DeSucursal(...GESTIONA)
  movimiento(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.i.movimiento(t, a.sub, Movimiento.parse(b)); }
  @Post('stock/traspasos') @HttpCode(200) @DeSucursal(...GESTIONA)
  traspaso(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.i.traspaso(t, a.sub, Traspaso.parse(b)); }
  @Post('stock/conteos') @HttpCode(200) @DeSucursal(...GESTIONA)
  conteo(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.i.conteo(t, a.sub, Conteo.parse(b)); }
}
