import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Actor, ActorActual, Publico, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { MIME_POR_EXT } from '../storage/storage.service';
import { Categoria, MenuService, Plato, PlatoParcial } from './menu.service';

const EDITA = ['owner', 'admin'] as const;

@Controller('menu')
export class MenuController {
  constructor(@Inject(MenuService) private readonly menu: MenuService) {}

  @Get('categorias') @DeSucursal()
  categorias(@TenantActual() t: Tenant) { return this.menu.categorias(t); }
  @Post('categorias') @DeSucursal(...EDITA)
  crearCategoria(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.menu.crearCategoria(t, a.sub, Categoria.parse(b)); }
  @Patch('categorias/:id') @DeSucursal(...EDITA)
  cambiarCategoria(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.menu.cambiarCategoria(t, a.sub, id, Categoria.parse(b)); }
  @Delete('categorias/:id') @DeSucursal(...EDITA)
  borrarCategoria(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.menu.borrarCategoria(t, a.sub, id); }

  @Get('platos') @DeSucursal()
  platos(@TenantActual() t: Tenant) { return this.menu.platos(t); }
  @Post('platos') @DeSucursal(...EDITA)
  crearPlato(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.menu.crearPlato(t, a.sub, Plato.parse(b)); }
  @Patch('platos/:id') @DeSucursal(...EDITA, 'cocina')
  cambiarPlato(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.menu.cambiarPlato(t, a.sub, id, PlatoParcial.parse(b)); }
  @Delete('platos/:id') @DeSucursal(...EDITA)
  borrarPlato(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.menu.borrarPlato(t, a.sub, id); }

  /** Foto del plato: el cuerpo es la imagen cruda (el navegador la reduce antes de subirla). El tipo se decide por su contenido. */
  @Put('platos/:id/foto') @HttpCode(200) @DeSucursal(...EDITA)
  foto(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.menu.fotoDePlato(t, a.sub, id, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
  }
}

/** Menú público por slug (sin sesión): el cliente lo ve desde el QR de la mesa o desde la web del restaurante. */
@Controller('public')
export class MenuPublicoController {
  constructor(@Inject(MenuService) private readonly menu: MenuService) {}

  @Publico() @Get(':slug/menu') @Header('Cache-Control', 'public, max-age=30')
  publico(@Param('slug') slug: string) { return this.menu.publico(slug); }

  @Publico() @Get(':slug/foto/:id')
  async foto(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { datos, clave } = await this.menu.fotoPublica(slug, id);
    res.setHeader('Content-Type', MIME_POR_EXT[clave.split('.').pop() ?? ''] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(datos);
  }
}
