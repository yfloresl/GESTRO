import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal, SoloPlataforma } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { AsistenteService, Pregunta } from './asistente.service';
import { FodaService, GenerarFoda } from './foda.service';
import { AjustesIa, IaService } from './ia.service';

const dia = (d: number) => new Date(Date.now() - 4 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10);
const LEE = ['owner', 'admin', 'contador'] as const;

/** FODA automático con evidencia. */
@Controller('reportes/foda')
export class FodaController {
  constructor(@Inject(FodaService) private readonly f: FodaService) {}

  @Get() @DeSucursal(...LEE)
  lista(@TenantActual() t: Tenant) { return this.f.lista(t); }
  @Get(':id') @DeSucursal(...LEE)
  ver(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.f.ver(t, id); }
  @Post('generar') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60_000 } }) @DeSucursal('owner', 'admin')
  generar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { const d = GenerarFoda.parse(b ?? {}); return this.f.generar(t, a.sub, d.desde ?? dia(-29), d.hasta ?? dia(0)); }
}

/** Asistente de gestión: preguntas en lenguaje natural, solo consulta. */
@Controller('asistente')
export class AsistenteController {
  constructor(@Inject(AsistenteService) private readonly s: AsistenteService, @Inject(IaService) private readonly ia: IaService) {}

  @Get('estado') @DeSucursal(...LEE)
  async estado(@TenantActual() t: Tenant) { return { disponible: await this.ia.disponible(), uso: await this.ia.usoDeSucursal(t) }; }
  @Post('preguntar') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60_000 } }) @DeSucursal(...LEE)
  preguntar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.preguntar(t, a.sub, Pregunta.parse(b).pregunta); }
}

/** Consola de Kyros-Tech: clave de Claude (cifrada), modelos, precios y límites. Nunca devuelve la clave. */
@Controller('plataforma/ia')
@SoloPlataforma()
export class PlataformaIaController {
  constructor(@Inject(IaService) private readonly ia: IaService) {}

  @Get() estado() { return this.ia.estado(); }
  @Put() @HttpCode(200) guardar(@ActorActual() a: Actor, @Body() b: unknown) { return this.ia.guardar(a.sub, AjustesIa.parse(b)); }
  @Delete('clave') quitar(@ActorActual() a: Actor) { return this.ia.quitarClave(a.sub); }
  @Post('probar') @HttpCode(200) probar() { return this.ia.probar(); }
}
