import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Entrega, PropinasService } from './propinas.service';

const VE = ['owner', 'admin', 'contador'] as const;
const ENTREGA = ['owner', 'admin'] as const;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const dia = (d: number) => new Date(Date.now() - 4 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);

@Controller()
export class PropinasController {
  constructor(@Inject(PropinasService) private readonly p: PropinasService) {}

  @Get('propinas') @DeSucursal(...VE)
  lista(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) {
    const desde = d ?? dia(-6); const hasta = h ?? dia(0);
    if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new BadRequestException('Fechas con formato AAAA-MM-DD.');
    return this.p.lista(t, desde, hasta);
  }

  @Post('propinas/entregar') @HttpCode(200) @DeSucursal(...ENTREGA)
  entregar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.p.entregar(t, a.sub, Entrega.parse(b)); }
}
