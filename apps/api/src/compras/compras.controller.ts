import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { ComprasService, NuevaOrden, Pago, Proveedor, Recepcion } from './compras.service';
import { Fecha } from '../recetas/recetas.service';

const COMPRAS = ['owner', 'admin', 'almacen'] as const;
const FINANZAS = ['owner', 'admin', 'contador'] as const;
const ESTADOS = ['borrador', 'enviada', 'parcial', 'recibida', 'cancelada'];

/** Compras y proveedores: órdenes, recepción contra la orden, historial de precios y cuentas por pagar. */
@Controller()
export class ComprasController {
  constructor(@Inject(ComprasService) private readonly c: ComprasService) {}

  @Get('proveedores') @DeSucursal(...COMPRAS, 'contador')
  proveedores(@TenantActual() t: Tenant) { return this.c.proveedores(t); }
  @Post('proveedores') @DeSucursal(...COMPRAS)
  crearProveedor(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.crearProveedor(t, a.sub, Proveedor.parse(b)); }
  @Patch('proveedores/:id') @DeSucursal(...COMPRAS)
  cambiarProveedor(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cambiarProveedor(t, a.sub, id, Proveedor.parse(b)); }
  @Get('insumos/:id/precios') @DeSucursal(...COMPRAS, 'contador')
  precios(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.c.precios(t, id); }

  @Get('ordenes-de-compra') @DeSucursal(...COMPRAS, 'contador')
  listar(@TenantActual() t: Tenant, @Query('estado') estado?: string) { return this.c.listar(t, estado && ESTADOS.includes(estado) ? estado : undefined); }
  @Get('ordenes-de-compra/:id') @DeSucursal(...COMPRAS, 'contador')
  detalle(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.c.detalle(t, id); }
  @Post('ordenes-de-compra') @DeSucursal(...COMPRAS)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.crear(t, a.sub, NuevaOrden.parse(b)); }
  @Post('ordenes-de-compra/:id/enviar') @HttpCode(200) @DeSucursal(...COMPRAS)
  enviar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.c.enviar(t, a.sub, id); }
  @Post('ordenes-de-compra/:id/cancelar') @HttpCode(200) @DeSucursal(...COMPRAS)
  cancelar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.c.cancelar(t, a.sub, id); }
  @Post('ordenes-de-compra/:id/recibir') @HttpCode(200) @DeSucursal(...COMPRAS)
  recibir(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.recibir(t, a.sub, id, Recepcion.parse(b)); }

  @Get('compras/sugerencias') @DeSucursal(...COMPRAS)
  sugerencias(@TenantActual() t: Tenant) { return this.c.sugerencias(t); }
  @Post('compras/sugerencias/ordenes') @HttpCode(200) @DeSucursal(...COMPRAS)
  ordenesSugeridas(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.c.ordenesSugeridas(t, a.sub); }
  @Post('plan-del-dia/:fecha/ordenes-de-compra') @HttpCode(200) @DeSucursal(...COMPRAS)
  ordenesDelPlan(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('fecha') fecha: string) { return this.c.ordenesDelPlan(t, a.sub, Fecha.parse(fecha)); }

  @Get('por-pagar') @DeSucursal(...FINANZAS, 'almacen')
  porPagar(@TenantActual() t: Tenant, @Query('todas') todas?: string) { return this.c.porPagar(t, todas !== '1'); }
  @Post('por-pagar/:id/pagar') @HttpCode(200) @DeSucursal(...FINANZAS)
  pagar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.pagar(t, a.sub, id, Pago.parse(b ?? {})); }
}
