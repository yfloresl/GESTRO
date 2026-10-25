import { Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Actor, ActorActual, ipDe, Publico } from '../comun/acceso';
import { COOKIE_REFRESCO, SesionService } from './sesion.service';

@Controller('auth')
export class AuthController {
  constructor(@Inject(SesionService) private readonly sesion: SesionService) {}

  @Publico() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Post('refrescar') @HttpCode(200)
  refrescar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.sesion.refrescar(req.cookies?.[COOKIE_REFRESCO], ipDe(req), res);
  }

  @Publico() @Post('salir') @HttpCode(204)
  async salir(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sesion.salir(req.cookies?.[COOKIE_REFRESCO], res);
  }

  @Get('yo')
  yo(@ActorActual() actor: Actor) {
    return this.sesion.yo(actor.sub);
  }
}
