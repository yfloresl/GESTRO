import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Fecha, NuevaReceta, PlanDelDia, RecetasService } from './recetas.service';

const COCINA = ['owner', 'admin', 'cocina'] as const;

/** Biblioteca de recetas (con versiones y sub-recetas) y plan del día. */
@Controller()
export class RecetasController {
  constructor(@Inject(RecetasService) private readonly r: RecetasService) {}

  @Get('recetas') @DeSucursal(...COCINA, 'almacen', 'contador')
  lista(@TenantActual() t: Tenant) { return this.r.lista(t); }
  @Get('recetas/plato/:id/versiones') @DeSucursal(...COCINA)
  versionesPlato(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.r.versiones(t, 'plato', id); }
  @Get('recetas/insumo/:id/versiones') @DeSucursal(...COCINA)
  versionesInsumo(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.r.versiones(t, 'insumo', id); }
  @Get('recetas/:id') @DeSucursal(...COCINA, 'almacen', 'contador')
  detalle(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.r.detalle(t, id); }
  @Post('recetas') @DeSucursal(...COCINA)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.r.crear(t, a.sub, NuevaReceta.parse(b)); }
  @Post('recetas/:id/activar') @HttpCode(200) @DeSucursal(...COCINA)
  activar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.r.activar(t, a.sub, id); }

  @Get('plan-del-dia/:fecha') @DeSucursal(...COCINA, 'almacen')
  verPlan(@TenantActual() t: Tenant, @Param('fecha') fecha: string) { return this.r.verPlan(t, Fecha.parse(fecha)); }
  @Put('plan-del-dia/:fecha') @DeSucursal(...COCINA)
  guardarPlan(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('fecha') fecha: string, @Body() b: unknown) { return this.r.guardarPlan(t, a.sub, Fecha.parse(fecha), PlanDelDia.parse(b)); }
}
