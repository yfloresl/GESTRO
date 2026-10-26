import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { EstadisticasService, GRUPOS, Grupo } from './estadisticas.service';

const VE = ['owner', 'admin', 'contador', 'area_manager'] as const;
const FINANZAS = ['owner', 'admin', 'contador'] as const;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const dia = (d: number) => new Date(Date.now() - 4 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);
const rango = (d?: string, h?: string) => {
  const desde = d ?? dia(-29); const hasta = h ?? dia(0);
  if (!FECHA.test(desde) || !FECHA.test(hasta)) throw new BadRequestException('Fechas con formato AAAA-MM-DD.');
  return { desde, hasta };
};
const numero = (v: string | undefined, def: number, min: number, max: number, que: string) => {
  const n = v === undefined || v === '' ? def : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${que} debe estar entre ${min} y ${max}.`);
  return n;
};

/** Estadísticas, proyecciones y escenarios. */
@Controller('estadisticas')
export class EstadisticasController {
  constructor(@Inject(EstadisticasService) private readonly e: EstadisticasService) {}

  @Get('resumen') @DeSucursal(...VE)
  resumen(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { const r = rango(d, h); return this.e.resumen(t, r.desde, r.hasta); }

  @Get('ventas') @DeSucursal(...VE)
  ventas(@TenantActual() t: Tenant, @Query('grupo') grupo?: string, @Query('desde') d?: string, @Query('hasta') h?: string) {
    if (!grupo || !(GRUPOS as readonly string[]).includes(grupo)) throw new BadRequestException(`Agrupa por: ${GRUPOS.join(', ')}.`);
    const r = rango(d, h); return this.e.ventas(t, grupo as Grupo, r.desde, r.hasta);
  }

  @Get('menu') @DeSucursal(...VE)
  menu(@TenantActual() t: Tenant, @Query('desde') d?: string, @Query('hasta') h?: string) { const r = rango(d, h); return this.e.menu(t, r.desde, r.hasta); }

  @Get('proyeccion') @DeSucursal(...FINANZAS)
  proyeccion(@TenantActual() t: Tenant, @Query('semanas') s?: string) { return this.e.proyeccion(t, numero(s, 4, 1, 8, 'Las semanas')); }

  @Get('escenario') @DeSucursal(...FINANZAS)
  escenario(@TenantActual() t: Tenant, @Query('precio') p?: string, @Query('demanda') dm?: string, @Query('semanas') s?: string) {
    return this.e.escenario(t, numero(p, 0, -50, 100, 'El cambio de precio'), numero(dm, 0, -90, 100, 'El cambio de demanda'), numero(s, 4, 1, 8, 'Las semanas'));
  }

  /** Solo las sucursales donde la persona es dueña o administra: ver otra sucursal en la que solo es mesera sería filtrar datos. */
  @Get('comparacion') @DeSucursal('owner', 'admin')
  comparacion(@ActorActual() a: Actor, @Query('desde') d?: string, @Query('hasta') h?: string) {
    const r = rango(d, h);
    const ids = a.rids.filter((id) => (a.roles[id] ?? []).some((x) => x === 'owner' || x === 'admin'));
    return this.e.comparar(ids, r.desde, r.hasta);
  }
}
