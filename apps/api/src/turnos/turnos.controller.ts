import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { DatosLaborales, Eventual, Fecha, Funcion, NuevoTurno, TurnosService } from './turnos.service';

const ADMIN = ['owner', 'admin'] as const;
const PROGRAMA = ['owner', 'admin', 'area_manager'] as const;
const VE = ['owner', 'admin', 'area_manager', 'contador'] as const;
const PAGO = ['owner', 'admin', 'contador'] as const;
const dia = (d: number) => new Date(Date.now() - 4 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);
const f = (v: string | undefined, defecto: string) => { const r = Fecha.safeParse(v ?? defecto); if (!r.success) throw new BadRequestException('Fecha con formato AAAA-MM-DD.'); return r.data; };
const rango = (desde: string | undefined, hasta: string | undefined, dd = 0, dh = 6) => {
  const a = f(desde, dia(dd)); const b = f(hasta, dia(dh));
  if (b < a) throw new BadRequestException('«Hasta» no puede ser anterior a «desde».');
  if (Date.parse(b) - Date.parse(a) > 62 * 86_400_000) throw new BadRequestException('El rango máximo es de dos meses.');
  return { desde: a, hasta: b };
};
const rolesDe = (a: Actor, t: Tenant) => a.roles[t.restaurantId] ?? [];

/** Funciones del personal, turnos, asistencia y costo de personal. */
@Controller()
export class TurnosController {
  constructor(@Inject(TurnosService) private readonly s: TurnosService) {}

  @Get('funciones') @DeSucursal(...VE)
  funciones(@TenantActual() t: Tenant) { return this.s.funciones(t); }
  @Post('funciones') @DeSucursal(...ADMIN)
  crearFuncion(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.crearFuncion(t, a.sub, Funcion.parse(b)); }
  @Delete('funciones/:id') @DeSucursal(...ADMIN)
  borrarFuncion(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.borrarFuncion(t, a.sub, id); }

  @Get('turnos/personas') @DeSucursal(...VE)
  personas(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.s.personas(t, rolesDe(a, t).some((r) => (PAGO as readonly string[]).includes(r))); }
  @Post('turnos/personas') @DeSucursal(...ADMIN)
  crearEventual(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.crearEventual(t, a.sub, Eventual.parse(b)); }
  @Patch('turnos/personas/:id') @DeSucursal(...ADMIN)
  laborales(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.datosLaborales(t, a.sub, id, DatosLaborales.parse(b)); }

  @Get('turnos/mis') @DeSucursal()
  mis(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Query('desde') d?: string, @Query('hasta') h?: string) { const r = rango(d, h, -1, 13); return this.s.mis(t, a.sub, r.desde, r.hasta); }
  @Get('turnos/costo') @DeSucursal(...PAGO)
  costo(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { const r = rango(d, h, -6, 0); return this.s.costo(t, r.desde, r.hasta); }

  @Get('turnos') @DeSucursal(...VE)
  lista(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Query('desde') d?: string, @Query('hasta') h?: string) { const r = rango(d, h); return this.s.lista(t, r.desde, r.hasta, rolesDe(a, t).some((x) => (PAGO as readonly string[]).includes(x))); }
  @Post('turnos') @DeSucursal(...PROGRAMA)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.crear(t, a.sub, NuevoTurno.parse(b)); }
  @Put('turnos/:id') @DeSucursal(...PROGRAMA)
  cambiar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.cambiar(t, a.sub, id, NuevoTurno.parse(b)); }
  @Delete('turnos/:id') @DeSucursal(...PROGRAMA)
  borrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.borrar(t, a.sub, id); }
  @Post('turnos/:id/entrada') @HttpCode(200) @DeSucursal()
  entrada(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.marcar(t, a.sub, rolesDe(a, t).some((r) => (PROGRAMA as readonly string[]).includes(r)), id, 'entrada'); }
  @Post('turnos/:id/salida') @HttpCode(200) @DeSucursal()
  salida(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.marcar(t, a.sub, rolesDe(a, t).some((r) => (PROGRAMA as readonly string[]).includes(r)), id, 'salida'); }
}
