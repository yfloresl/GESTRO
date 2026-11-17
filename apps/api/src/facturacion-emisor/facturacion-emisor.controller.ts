import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { FacturacionEmisorService } from './facturacion-emisor.service';

const DUENO = ['owner', 'admin'] as const;
const COBRO = ['cajero', 'owner', 'admin'] as const;

/** Facturación del restaurante a sus comensales vía FacturaSIN (Flujo 2). Todo en ambiente de pruebas / sin validez fiscal por ahora. */
@Controller()
export class FacturacionEmisorController {
  constructor(@Inject(FacturacionEmisorService) private readonly s: FacturacionEmisorService) {}

  @Get('facturacion/config') @DeSucursal(...DUENO)
  config(@TenantActual() t: Tenant) { return this.s.config(t); }
  @Put('facturacion/config') @HttpCode(200) @DeSucursal(...DUENO)
  guardar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.guardarConfig(t, a.sub, b); }
  @Post('facturacion/probar') @HttpCode(200) @DeSucursal(...DUENO)
  probar(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.s.probar(t, a.sub); }
  @Get('facturacion/rubros') @DeSucursal(...DUENO)
  rubros(@TenantActual() t: Tenant) { return this.s.rubros(t); }
  @Put('facturacion/rubro') @HttpCode(200) @DeSucursal(...DUENO)
  rubro(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.elegirRubro(t, a.sub, b); }
  @Get('facturacion/estado') @DeSucursal(...COBRO)
  estado(@TenantActual() t: Tenant) { return this.s.estado(t); }
  @Post('facturacion/conciliar') @HttpCode(200) @DeSucursal(...COBRO)
  conciliar(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.s.conciliar(t, a.sub); }

  @Post('pedidos/:id/facturar') @HttpCode(200) @DeSucursal(...COBRO)
  facturar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.facturar(t, a.sub, id, b); }
  @Get('pedidos/:id/factura') @DeSucursal(...COBRO, 'mesero')
  delPedido(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.s.delPedido(t, id); }

  @Get('facturas') @DeSucursal(...COBRO)
  lista(@TenantActual() t: Tenant, @Query('estado') estado?: string) { return this.s.lista(t, estado); }
  @Post('facturas/:id/reintentar') @HttpCode(200) @DeSucursal(...COBRO)
  reintentar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.reintentar(t, a.sub, id); }
  @Post('facturas/:id/verificar') @HttpCode(200) @DeSucursal(...COBRO)
  verificar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.verificar(t, a.sub, id); }
  @Post('facturas/:id/reenviar-aviso') @HttpCode(200) @DeSucursal(...COBRO)
  reenviar(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.s.reenviarAviso(t, id); }
  @Post('facturas/:id/anular') @HttpCode(200) @DeSucursal(...DUENO)
  anular(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.anular(t, a.sub, id, b); }

  @Get('facturas/:id/pdf') @Header('Content-Type', 'application/pdf') @Header('Content-Disposition', 'inline; filename="factura.pdf"') @DeSucursal(...COBRO, 'mesero')
  async pdf(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string, @Query('formato') formato?: string) { return new StreamableFile(await this.s.archivo(t, id, 'pdf', formato === 'rollo' ? 'rollo' : 'a4')); }
  @Get('facturas/:id/xml') @Header('Content-Type', 'application/xml') @DeSucursal(...DUENO)
  async xml(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return new StreamableFile(await this.s.archivo(t, id, 'xml', 'a4')); }
}
