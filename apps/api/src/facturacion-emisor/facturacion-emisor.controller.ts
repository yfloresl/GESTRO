import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Actor, ActorActual, Publico, TenantActual } from '../comun/acceso';
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
  @Post('facturacion/conectar') @HttpCode(200) @DeSucursal(...DUENO)
  conectar(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.s.conectar(t, a.sub); }
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
  @Post('facturas/:id/anular') @HttpCode(200) @DeSucursal(...DUENO)
  anular(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.anular(t, a.sub, id, b); }

  @Get('facturas/:id/pdf') @Header('Content-Type', 'application/pdf') @Header('Content-Disposition', 'inline; filename="factura.pdf"') @DeSucursal(...COBRO, 'mesero')
  async pdf(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string, @Query('formato') formato?: string) { return new StreamableFile(await this.s.archivo(t, id, 'pdf', formato === 'rollo' ? 'rollo' : 'a4')); }
  @Get('facturas/:id/xml') @Header('Content-Type', 'application/xml') @DeSucursal(...DUENO)
  async xml(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return new StreamableFile(await this.s.archivo(t, id, 'xml', 'a4')); }
}

/** Retorno de estados desde FacturaSIN: firmado con HMAC-SHA256 (X-FacturaSIN-Signature) sobre el cuerpo crudo. Sin sesión, con límite de uso. */
@Controller('public/facturasin')
export class FacturasinWebhookController {
  constructor(@Inject(FacturacionEmisorService) private readonly s: FacturacionEmisorService) {}

  @Publico() @Throttle({ default: { limit: 120, ttl: 60_000 } }) @Post('webhook/:restaurantId') @HttpCode(200)
  recibir(@Param('restaurantId') rid: string, @Req() req: Request & { rawBody?: Buffer }) {
    return this.s.recibirWebhook(rid, req.header('x-facturasin-signature'), req.header('x-facturasin-event-id'), req.rawBody?.toString('utf8'));
  }
}
