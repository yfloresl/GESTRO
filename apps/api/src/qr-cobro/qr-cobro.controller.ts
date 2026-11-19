import { ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, Get, Headers, HttpCode, HttpException, Inject, Param, ParseUUIDPipe, Put, Res, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Actor, ActorActual, Publico, TenantActual } from '../comun/acceso';
import { DeSucursal, DeSucursalSiempre, SoloPlataforma } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { QR_MAX_BYTES } from './kyros-qr-imagen';
import { errorHttpQr, QrCobroService } from './qr-cobro.service';

const ADMIN = ['owner', 'admin'] as const;
const CAJA = ['cajero', 'owner', 'admin'] as const;
const MSG_TAMANO = 'La imagen es demasiado pesada (máximo 2 MB). Usa una captura o foto más liviana.';
const MSG_VACIO = 'No llegó ningún archivo. Elige la imagen de tu QR e inténtalo de nuevo.';

/** Errores de la subida multipart (tamaño, campo inesperado) con el mismo formato {code, codigo, message} que el resto del módulo. */
@Catch()
export class FiltroSubidaQr implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const estado = error.getStatus();
      const c = error.getResponse();
      const base = (typeof c === 'string' ? { message: c } : c) as { code?: string; codigo?: string; message?: string };
      if (base.codigo) return res.status(estado).json({ code: base.codigo, codigo: base.codigo, message: base.message });
      if (estado === 413) return res.status(413).json({ code: 'tamano', codigo: 'tamano', message: MSG_TAMANO });
      if (estado === 400) return res.status(400).json({ code: 'vacio', codigo: 'vacio', message: MSG_VACIO });
      return res.status(estado).json({ code: base.code ?? 'ERROR', message: base.message });
    }
    return res.status(500).json({ code: 'INTERNAL', message: 'Error interno' });
  }
}

type Subido = { buffer?: Buffer } | undefined;
const SUBIDA = () => FileInterceptor('file', { limits: { fileSize: QR_MAX_BYTES, files: 1 } }); // memoria (multer por defecto); 2 MB, un solo archivo

/** El QR de cobro es del administrador de ESA sucursal: el id de la ruta debe ser la sucursal que valida la guarda. */
function soloEsaSucursal(t: Tenant, id: string) {
  if (t.restaurantId !== id) throw errorHttpQr('permiso', 'No tienes permiso para cambiar este QR. Contacta a quien administra.', 403);
}

@Controller()
export class QrCobroController {
  constructor(@Inject(QrCobroService) private readonly s: QrCobroService) {}

  /** Imagen del QR por su id opaco: solo lectura, pública (la ve quien paga). */
  @Publico() @Get('public/qr/:id')
  async servir(@Param('id') id: string, @Headers('if-none-match') inm: string | undefined, @Res() res: Response) {
    const r = await this.s.servir(id, inm);
    for (const [k, v] of Object.entries(r.cabeceras)) res.setHeader(k, v);
    if (r.estado === 304) return res.status(304).end();
    return res.status(200).end(r.cuerpo);
  }

  /* ---- plataforma (Kyros-Tech) ---- */
  @Publico() @Get('qr-cobro/plataforma')
  verPlataforma() { return this.s.ver('plataforma').then(({ url, banco, esRespaldo }) => ({ url, banco, esRespaldo })); }

  @SoloPlataforma() @Put('qr-cobro/plataforma') @HttpCode(200) @UseInterceptors(SUBIDA()) @UseFilters(FiltroSubidaQr)
  async subirPlataforma(@ActorActual() a: Actor, @UploadedFile() f: Subido, @Body() b: { banco?: unknown }) {
    const r = await this.s.guardar('plataforma', a.sub, f?.buffer, b?.banco);
    return { url: r.url, banco: r.banco, esRespaldo: false };
  }

  @SoloPlataforma() @Delete('qr-cobro/plataforma') @HttpCode(200)
  quitarPlataforma(@ActorActual() a: Actor) { return this.s.quitar('plataforma', a.sub); }

  /* ---- cliente (la sucursal del restaurante) ---- */
  /** Lo ve quien cobra en caja (cajero y dueños). */
  @DeSucursalSiempre(...CAJA) @Get('qr-cobro/cliente/:id')
  verCliente(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) {
    soloEsaSucursal(t, id);
    return this.s.ver('cliente', id).then(({ url, banco, esRespaldo }) => ({ url, banco, esRespaldo }));
  }

  @DeSucursal(...ADMIN) @Put('qr-cobro/cliente/:id') @HttpCode(200) @UseInterceptors(SUBIDA()) @UseFilters(FiltroSubidaQr)
  async subirCliente(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() f: Subido, @Body() b: { banco?: unknown }) {
    soloEsaSucursal(t, id);
    const r = await this.s.guardar('cliente', a.sub, f?.buffer, b?.banco, id);
    return { url: r.url, banco: r.banco, esRespaldo: false };
  }

  @DeSucursal(...ADMIN) @Delete('qr-cobro/cliente/:id') @HttpCode(200)
  quitarCliente(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    soloEsaSucursal(t, id);
    return this.s.quitar('cliente', a.sub, id);
  }
}
