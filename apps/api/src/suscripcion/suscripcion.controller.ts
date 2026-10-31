import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursalSiempre, SoloPlataforma } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { AjusteSucursal, NuevoPago, Plan, Promocion, Rechazo, SuscripcionService } from './suscripcion.service';

const DUENOS = ['owner', 'admin'] as const;
const cuerpoImagen = (req: Request) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
const enviarImagen = (res: Response, datos: Buffer) => {
  const png = datos[0] === 0x89; const webp = datos[0] === 0x52;
  res.setHeader('Content-Type', png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(datos);
};

/** Suscripción de la sucursal. Sigue funcionando en modo solo lectura: justo ahí es cuando hay que pagar. */
@Controller('suscripcion')
export class SuscripcionController {
  constructor(@Inject(SuscripcionService) private readonly s: SuscripcionService) {}

  @Get() @DeSucursalSiempre(...DUENOS)
  mia(@TenantActual() t: Tenant) { return this.s.mia(t); }

  @Get('alcance') @DeSucursalSiempre()
  alcance(@TenantActual() t: Tenant) { return this.s.alcance(t); }

  @Get('calculo') @DeSucursalSiempre(...DUENOS)
  calculo(@TenantActual() t: Tenant, @Query('meses', ParseIntPipe) meses: number) { return this.s.calculo(t, meses); }

  @Post('pagos') @DeSucursalSiempre(...DUENOS)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.crearPago(t, a.sub, NuevoPago.parse(b)); }

  @Put('pagos/:id/voucher') @HttpCode(200) @DeSucursalSiempre(...DUENOS)
  voucher(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) { return this.s.subirVoucher(t, a.sub, id, cuerpoImagen(req)); }

  @Get('pagos/:id/voucher') @DeSucursalSiempre(...DUENOS)
  async verVoucher(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { enviarImagen(res, await this.s.voucherDeMiPago(t, id)); }

  /** QR bancario de cobro de Kyros-Tech, para mostrarlo en «Pagar». */
  @Get('cobro/qr') @DeSucursalSiempre(...DUENOS)
  async qr(@Res() res: Response) { enviarImagen(res, await this.s.qrDeCobro()); }
}

const Estado = z.enum(['pendiente', 'validado', 'rechazado', 'todos']).default('pendiente');

/** Consola de Kyros-Tech: valida pagos a mano, administra planes, promociones, QR de cobro y sucursales. */
@Controller('plataforma')
@SoloPlataforma()
export class PlataformaController {
  constructor(@Inject(SuscripcionService) private readonly s: SuscripcionService) {}

  @Get('pagos') pagos(@Query('estado') estado?: string) { return this.s.pagos(Estado.parse(estado)); }
  @Get('pagos/:id/voucher') async voucher(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { enviarImagen(res, await this.s.voucherDePlataforma(id)); }
  @Post('pagos/:id/aprobar') @HttpCode(200) aprobar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.aprobar(a.sub, id); }
  @Post('pagos/:id/rechazar') @HttpCode(200) rechazar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.rechazar(a.sub, id, Rechazo.parse(b).motivo); }

  @Get('cobro') cobro() { return this.s.cobro(); }
  @Put('cobro') @HttpCode(200) guardarCobro(@Body() b: unknown) { return this.s.guardarCobro(z.object({ instrucciones: z.string().trim().max(1000) }).strict().parse(b).instrucciones); }
  @Put('cobro/qr') @HttpCode(200) guardarQr(@Req() req: Request) { return this.s.guardarQr(cuerpoImagen(req)); }
  @Get('cobro/qr') async verQr(@Res() res: Response) { enviarImagen(res, await this.s.qrDeCobro()); }

  @Get('promociones') promociones() { return this.s.promociones(); }
  @Post('promociones') crearPromocion(@Body() b: unknown) { return this.s.crearPromocion(Promocion.parse(b)); }
  @Patch('promociones/:id') cambiarPromocion(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.cambiarPromocion(id, Promocion.parse(b)); }

  @Get('planes') planes() { return this.s.planes(); }
  @Post('planes') crearPlan(@Body() b: unknown) { return this.s.crearPlan(Plan.parse(b)); }
  @Patch('planes/:id/paquete') aplicarPaquete(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.aplicarPaquete(id, z.object({ aplicar: z.boolean() }).strict().parse(b).aplicar); }
  @Patch('planes/:id') cambiarPlan(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.cambiarPlan(id, Plan.parse(b)); }

  @Get('sucursales') sucursales() { return this.s.sucursales(); }
  @Patch('sucursales/:id') ajustar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.ajustarSucursal(a.sub, id, AjusteSucursal.parse(b)); }
}
