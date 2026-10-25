import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Headers } from '@nestjs/common';
import { z } from 'zod';
import { Actor, ActorActual } from '../comun/acceso';
import { PushService } from './push.service';

const Suscripcion = z.object({ endpoint: z.string().url().max(600), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }).strict() }).strict();

/** Avisos con la pantalla bloqueada: por persona (cualquier sesión de personal), no por sucursal. */
@Controller('push')
export class PushController {
  constructor(@Inject(PushService) private readonly push: PushService) {}

  @Get('clave')
  async clave() { return { clave: await this.push.clavePublica() }; }

  @Post('suscribir') @HttpCode(200)
  async suscribir(@ActorActual() a: Actor, @Body() b: unknown, @Headers('user-agent') ua?: string) { await this.push.suscribir(a.sub, Suscripcion.parse(b), ua); return { ok: true }; }

  @Delete('suscribir') @HttpCode(200)
  async anular(@ActorActual() a: Actor, @Body() b: unknown) { await this.push.anular(a.sub, z.object({ endpoint: z.string().url() }).strict().parse(b).endpoint); return { ok: true }; }
}
