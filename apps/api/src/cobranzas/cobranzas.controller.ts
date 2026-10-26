import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { CobranzasService, CobroDeCuenta } from './cobranzas.service';

const COBRO = ['owner', 'admin', 'cobranzas', 'cajero', 'contador'] as const;

/** Cuentas por cobrar (ventas a crédito) y sus cobros. */
@Controller()
export class CobranzasController {
  constructor(@Inject(CobranzasService) private readonly c: CobranzasService) {}

  @Get('por-cobrar') @DeSucursal(...COBRO)
  lista(@TenantActual() t: Tenant, @Query('todas') todas?: string) { return this.c.porCobrar(t, todas !== '1'); }
  @Post('por-cobrar/:id/cobrar') @HttpCode(200) @DeSucursal(...COBRO)
  cobrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cobrar(t, a.sub, id, CobroDeCuenta.parse(b ?? {})); }
}
