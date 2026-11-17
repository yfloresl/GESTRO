import { Body, Controller, Get, Header, HttpCode, HttpException, Inject, Param, ParseUUIDPipe, Post, Put, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Actor, ActorActual, Publico, TenantActual } from '../comun/acceso';
import { DeSucursalSiempre, SoloPlataforma } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { Anular, ConfigParcial, DatosFiscalesBody, Emitir, FacturacionKyrosService, FiltroLista } from './facturacion-kyros.service';

const DUENOS = ['owner', 'admin'] as const;
const VENTANA_REAUTH_S = 15 * 60;
const reauth = (a: Actor) => { if (!a.aat || Date.now() / 1000 - a.aat > VENTANA_REAUTH_S) throw new HttpException({ code: 'REAUTH_REQUERIDA', message: 'Confirma tu identidad otra vez para cambiar la configuración de facturación.' }, 401); };
const TIPOS: Record<string, string> = { pdf: 'application/pdf', xml: 'application/xml; charset=utf-8', qr: 'image/png' };
const enviar = (res: Response, tipo: 'pdf' | 'xml' | 'qr', datos: Buffer, nombre: string) => {
  res.setHeader('Content-Type', TIPOS[tipo]); res.setHeader('Content-Disposition', `inline; filename="${nombre}.${tipo === 'qr' ? 'png' : tipo}"`);
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Ambiente-Fiscal', 'pruebas; sin validez fiscal mientras FacturaSIN opere en simulación');
  res.send(datos);
};
const Formato = z.enum(['a4', 'rollo']).default('a4');

/** Panel SuperAdmin «Facturación de Kyros»: solo el equipo de plataforma (SuperAdmin/administración de Kyros-Tech). */
@Controller('plataforma/facturacion-kyros')
@SoloPlataforma()
export class FacturacionKyrosController {
  constructor(@Inject(FacturacionKyrosService) private readonly s: FacturacionKyrosService) {}

  @Get() lista(@Query() q: unknown) { return this.s.listar(FiltroLista.parse(q)); }
  @Get('alertas') alertas() { return this.s.alertas(); }
  @Get('exportar.csv') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="facturacion-kyros.csv"')
  csv(@Query() q: unknown) { const f = FiltroLista.parse(q); return this.s.csv(f); }

  @Get('integracion') integracion() { return this.s.estadoIntegracion(); }
  /** Catálogo sincronizado de FacturaSIN (productos SIN, actividades, unidades, métodos de pago) para elegir los códigos que GESTRO envía en cada ítem. */
  @Get('catalogo/:nombre') catalogo(@Param('nombre') nombre: string) { return this.s.catalogo(nombre); }
  @Put('integracion') @HttpCode(200) guardar(@ActorActual() a: Actor, @Body() b: unknown) { reauth(a); return this.s.guardarConfig(a, ConfigParcial.parse(b)); }
  /** «Verificar / Reintentar»: el servidor asegura el enlace y el webhook solo (sin contrasena de Kyros ID ni URL tecleada: la URL es la derivada del sitio). */
  @Get('integracion/entregas') entregas() { return this.s.entregasAviso(); }
  @Post('integracion/probar-entrega') @HttpCode(200) probarEntrega() { return this.s.probarEntregaAviso(); }
  @Post('integracion/verificar') @HttpCode(200)
  verificar(@ActorActual() a: Actor, @Body() b: unknown) { const t = (b && typeof b === 'object' ? (b as { token?: unknown }).token : undefined); return this.s.verificarIntegracion(a, typeof t === 'string' && t.length > 20 ? t : null); }

  @Post('pagos/:id/emitir') @HttpCode(200) emitir(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.emitirPago(id, a.sub, Emitir.parse(b ?? {})); }
  @Post('pagos/:id/reintentar') @HttpCode(200) reintentar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.emitirPago(id, a.sub, Emitir.parse(b ?? {}), 'facturacion_kyros.reintentar'); }
  @Post('facturas/:id/anular') @HttpCode(200) anular(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.s.anular(a, id, Anular.parse(b)); }
  @Post('conciliar') @HttpCode(200) conciliar() { return this.s.ciclo(); }

  @Get('facturas/:id/:tipo')
  async documento(@Param('id', ParseUUIDPipe) id: string, @Param('tipo') tipo: string, @Query('formato') formato: string | undefined, @Res() res: Response) {
    const t = z.enum(['pdf', 'xml', 'qr']).parse(tipo);
    enviar(res, t, await this.s.documento(id, t, Formato.parse(formato)), `factura-kyros-${id.slice(0, 8)}`);
  }
}

/** Retorno de FacturaSIN: se autentica SOLO por la firma HMAC del cuerpo crudo (sin sesión). */
@Controller('webhooks')
export class FacturacionKyrosWebhookController {
  constructor(@Inject(FacturacionKyrosService) private readonly s: FacturacionKyrosService) {}

  @Publico() @Post('facturasin') @HttpCode(200)
  async recibir(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const crudo = req.rawBody?.toString('utf8') ?? '';
    const r = await this.s.recibirWebhook(String(req.headers['x-facturasin-signature'] ?? ''), String(req.headers['x-facturasin-event-id'] ?? ''), crudo);
    res.status(r.http).json({ ok: r.http === 200, resultado: r.resultado });
  }
}

/** Lado del cliente (dueño): sus datos fiscales y sus facturas. */
@Controller('suscripcion')
export class FacturacionKyrosClienteController {
  constructor(@Inject(FacturacionKyrosService) private readonly s: FacturacionKyrosService) {}

  @Get('datos-fiscales') @DeSucursalSiempre(...DUENOS) datos(@TenantActual() t: Tenant) { return this.s.datosFiscales(t); }
  @Put('datos-fiscales') @HttpCode(200) @DeSucursalSiempre(...DUENOS) guardar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.s.guardarDatosFiscales(t, a.sub, DatosFiscalesBody.parse(b)); }
  @Get('facturas') @DeSucursalSiempre(...DUENOS) facturas(@TenantActual() t: Tenant) { return this.s.misFacturas(t); }
  @Get('facturas/:id/pdf') @DeSucursalSiempre(...DUENOS)
  async pdf(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) { enviar(res, 'pdf', await this.s.documento(id, 'pdf', 'a4', t.restaurantId), `factura-${id.slice(0, 8)}`); }
}
