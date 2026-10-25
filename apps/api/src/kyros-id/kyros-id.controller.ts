import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ipDe, Publico } from '../comun/acceso';
import { KyrosIdService, RegistroSchema, VincularSchema } from './kyros-id.service';

/** Mismo contrato que `CanjeKyrosId` de @gestro/contracts (la API solo importa tipos de ese paquete). */
const CanjeKyrosIdSchema = z.object({ accessToken: z.string().min(20).max(8192) }).strict();

/** Límite propio del ingreso: 10 intentos por minuto y por IP. */
const INGRESO = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth/kyros-id')
export class KyrosIdController {
  constructor(@Inject(KyrosIdService) private readonly kyros: KyrosIdService) {}

  /** Público y sin red: el navegador oculta el botón si Kyros ID está apagado. */
  @Publico() @Get('config')
  config() { return this.kyros.publico(); }

  @Publico() @Throttle(INGRESO) @Post('sesion') @HttpCode(200)
  canjear(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken } = CanjeKyrosIdSchema.parse(body);
    return this.kyros.canjear(accessToken, ipDe(req), res);
  }

  @Publico() @Throttle(INGRESO) @Post('vincular') @HttpCode(200)
  vincular(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.kyros.vincular(VincularSchema.parse(body), ipDe(req), res);
  }

  @Publico() @Throttle(INGRESO) @Post('registro') @HttpCode(200)
  registrar(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.kyros.registrar(RegistroSchema.parse(body), ipDe(req), res);
  }

  /** Aviso de cierre de sesión global, firmado por Kyros ID (application/x-www-form-urlencoded: logout_token). */
  @Publico() @Post('backchannel-logout') @HttpCode(200)
  async backchannel(@Body() body: { logout_token?: string }) {
    await this.kyros.avisoDeCierre(String(body?.logout_token ?? ''));
  }
}
