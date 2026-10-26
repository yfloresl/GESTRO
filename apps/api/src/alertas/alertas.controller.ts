import { BadRequestException, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { AlertasService } from './alertas.service';

const VE = ['owner', 'admin', 'area_manager', 'contador'] as const;
const TIPOS = ['demora_cocina', 'merma_alta', 'margen_bajo', 'ventas_bajas', 'stock_bajo', 'precio_alto', 'contabilidad'];

/** Alertas con explicación: demoras de cocina, merma, margen, caída de ventas, stock y precios. */
@Controller('alertas')
export class AlertasController {
  constructor(@Inject(AlertasService) private readonly a: AlertasService) {}

  @Get() @DeSucursal(...VE)
  lista(@TenantActual() t: Tenant, @Query('estado') estado?: string, @Query('tipo') tipo?: string) {
    const e = estado ?? 'abiertas';
    if (!['abiertas', 'resueltas', 'todas'].includes(e)) throw new BadRequestException('Estado: abiertas, resueltas o todas.');
    if (tipo && !TIPOS.includes(tipo)) throw new BadRequestException('Tipo de alerta no válido.');
    return this.a.lista(t, { estado: e as 'abiertas' | 'resueltas' | 'todas', tipo });
  }
  @Post('revisar') @HttpCode(200) @DeSucursal('owner', 'admin')
  revisar(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.a.evaluar(t, a.sub); }
  @Post(':id/resolver') @HttpCode(200) @DeSucursal('owner', 'admin')
  resolver(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.a.resolver(t, a.sub, id); }
}
