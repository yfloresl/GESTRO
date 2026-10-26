import { Body, Controller, Delete, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal, PermiteEnDemo, SoloPlataforma } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { CargarDemo, DemoService } from './demo.service';

/** Consola de plataforma: cargar y quitar la sucursal de demostración de las cuentas Prueba_Kyros. */
@Controller('plataforma/demo')
@SoloPlataforma()
export class PlataformaDemoController {
  constructor(@Inject(DemoService) private readonly d: DemoService) {}

  @Get() estado() { return this.d.estado(); }
  @Post() @HttpCode(200) cargar(@ActorActual() a: Actor, @Body() b: unknown) { return this.d.cargar(a.sub, CargarDemo.parse(b ?? {})); }
  @Delete() quitar(@ActorActual() a: Actor) { return this.d.quitar(a.sub); }
}

/** Lo único que se puede escribir en la sucursal de demostración: restablecer sus propios datos de muestra. */
@Controller('demo')
export class DemoController {
  constructor(@Inject(DemoService) private readonly d: DemoService) {}

  @Post('restablecer') @HttpCode(200) @Throttle({ default: { limit: 5, ttl: 60_000 } }) @PermiteEnDemo() @DeSucursal('owner')
  restablecer(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.d.restablecer(t.restaurantId, a.sub); }
}
