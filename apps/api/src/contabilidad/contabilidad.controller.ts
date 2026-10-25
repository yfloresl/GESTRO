import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { CambioCuenta, ContabilidadService, NuevaCuenta, NuevoAsiento, NuevoCentro, Periodo, Rango, Tasas } from './contabilidad.service';

const CONTA = ['owner', 'admin', 'contador'] as const;
const Motivo = z.object({ motivo: z.string().trim().min(3).max(120).optional() }).strict();
const Filtro = z.object({ desde: z.string().optional(), hasta: z.string().optional(), estado: z.enum(['borrador', 'publicado']).optional(), origen: z.string().max(40).optional() }).strict();

const rango = (desde?: string, hasta?: string) => { const r = Rango.safeParse({ ...(desde && { desde }), ...(hasta && { hasta }) }); if (!r.success) throw new BadRequestException('Fechas con formato AAAA-MM-DD.'); return r.data; };

/** Contabilidad de nivel medio: plan de cuentas, asientos, reportes y cierre de períodos. Solo dueño, administración y contador. */
@Controller('contabilidad')
export class ContabilidadController {
  constructor(@Inject(ContabilidadService) private readonly c: ContabilidadService) {}

  @Get('cuentas') @DeSucursal(...CONTA)
  cuentas(@TenantActual() t: Tenant) { return this.c.cuentas(t); }
  @Post('cuentas') @DeSucursal(...CONTA)
  crearCuenta(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.crearCuenta(t, a.sub, NuevaCuenta.parse(b)); }
  @Patch('cuentas/:id') @DeSucursal(...CONTA)
  cambiarCuenta(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cambiarCuenta(t, a.sub, id, CambioCuenta.parse(b)); }
  @Get('centros-de-costo') @DeSucursal(...CONTA)
  centros(@TenantActual() t: Tenant) { return this.c.centros(t); }
  @Post('centros-de-costo') @DeSucursal(...CONTA)
  crearCentro(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.crearCentro(t, a.sub, NuevoCentro.parse(b)); }

  @Get('asientos') @DeSucursal(...CONTA)
  asientos(@TenantActual() t: Tenant, @Query() q: Record<string, string>) { const f = Filtro.safeParse(q); if (!f.success) throw new BadRequestException('Filtros no válidos.'); return this.c.asientos(t, f.data); }
  @Get('asientos/:id') @DeSucursal(...CONTA)
  asiento(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.c.asiento(t, id); }
  @Post('asientos') @DeSucursal(...CONTA)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.crearBorrador(t, a.sub, NuevoAsiento.parse(b)); }
  @Put('asientos/:id') @DeSucursal(...CONTA)
  cambiar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cambiarBorrador(t, a.sub, id, NuevoAsiento.parse(b)); }
  @Delete('asientos/:id') @DeSucursal(...CONTA)
  borrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.c.borrarBorrador(t, a.sub, id); }
  @Post('asientos/:id/publicar') @HttpCode(200) @DeSucursal(...CONTA)
  publicar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.c.publicar(t, a.sub, id); }
  @Post('asientos/:id/contrarrestar') @HttpCode(200) @DeSucursal(...CONTA)
  contrarrestar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.contrarrestar(t, a.sub, id, Motivo.parse(b ?? {}).motivo); }

  @Get('reportes/comprobacion') @DeSucursal(...CONTA)
  comprobacion(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.comprobacion(t, rango(d, h)); }
  @Get('reportes/resultados') @DeSucursal(...CONTA)
  resultados(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.estadoDeResultados(t, rango(d, h)); }
  @Get('reportes/balance') @DeSucursal(...CONTA)
  balance(@TenantActual() t: Tenant, @Query('hasta') h?: string) { return this.c.balanceGeneral(t, rango(undefined, h)); }
  @Get('reportes/mayor/:codigo') @DeSucursal(...CONTA)
  mayor(@TenantActual() t: Tenant, @Param('codigo') codigo: string, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.libroMayor(t, codigo, rango(d, h)); }
  @Get('reportes/flujo-de-caja') @DeSucursal(...CONTA)
  flujo(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.flujoDeCaja(t, rango(d, h)); }
  @Get('reportes/libro-de-ventas') @DeSucursal(...CONTA)
  libroVentas(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.libroIva(t, 'ventas', rango(d, h)); }
  @Get('reportes/libro-de-compras') @DeSucursal(...CONTA)
  libroCompras(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.libroIva(t, 'compras', rango(d, h)); }
  @Get('reportes/impuestos') @DeSucursal(...CONTA)
  impuestos(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { return this.c.impuestos(t, rango(d, h)); }

  @Get('tasas') @DeSucursal(...CONTA)
  tasas(@TenantActual() t: Tenant) { return this.c.tasasDeImpuestos(t); }
  @Put('tasas') @DeSucursal('owner', 'admin')
  cambiarTasas(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.cambiarTasas(t, a.sub, Tasas.parse(b)); }

  @Get('periodos') @DeSucursal(...CONTA)
  periodos(@TenantActual() t: Tenant) { return this.c.periodos(t); }
  @Post('periodos/cerrar') @HttpCode(200) @DeSucursal(...CONTA)
  cerrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.cerrarPeriodo(t, a.sub, Periodo.parse(b)); }
  @Post('periodos/reabrir') @HttpCode(200) @DeSucursal('owner')
  reabrir(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.reabrirPeriodo(t, a.sub, a.roles[t.restaurantId] ?? [], Periodo.parse(b)); }
}
