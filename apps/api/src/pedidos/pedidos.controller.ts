import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { AbrirCaja, AjustesSucursal, CajaService, CerrarCaja, Cobro } from './caja.service';
import { AgregarItems, EstadoCocina, MoverMesa, Motivo, NuevoPedido, PedidosService } from './pedidos.service';

const SALON = ['owner', 'admin', 'mesero', 'cajero', 'area_manager'] as const;
const CAJA = ['cajero', 'owner', 'admin'] as const;
const COCINA = ['cocina', 'owner', 'admin'] as const;
const ANULA = ['owner', 'admin', 'cajero', 'area_manager'] as const;
const Filtro = z.object({ filtro: z.enum(['abiertos', 'hoy']).default('abiertos'), tipo: z.enum(['mesa', 'mostrador', 'llevar', 'delivery']).optional() });

@Controller()
export class PedidosController {
  constructor(@Inject(PedidosService) private readonly p: PedidosService) {}

  @Post('pedidos') @DeSucursal(...SALON)
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.p.crear(t, a.sub, NuevoPedido.parse(b)); }

  @Get('pedidos') @DeSucursal(...SALON, 'cocina')
  listar(@TenantActual() t: Tenant, @Query() q: Record<string, string>) { const f = Filtro.parse(q); return this.p.listar(t, f.filtro, f.tipo); }

  @Get('pedidos/:id') @DeSucursal(...SALON, 'cocina')
  detalle(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.p.detalle(t, id); }

  @Post('pedidos/:id/items') @DeSucursal(...SALON)
  agregar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.p.agregar(t, a.sub, id, AgregarItems.parse(b)); }

  @Delete('items/:id') @DeSucursal(...SALON)
  quitar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.p.quitar(t, a.sub, id); }

  @Post('pedidos/:id/enviar') @HttpCode(200) @DeSucursal(...SALON)
  enviar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.p.enviar(t, a.sub, id); }

  @Post('items/:id/anular') @HttpCode(200) @DeSucursal(...ANULA)
  anular(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.p.anularItem(t, a.sub, id, Motivo.parse(b).motivo); }

  @Post('pedidos/:id/mover-mesa') @HttpCode(200) @DeSucursal(...SALON)
  mover(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.p.moverMesa(t, a.sub, id, MoverMesa.parse(b).mesaId); }

  /* ---- Cocina (KDS) ---- */
  @Get('cocina/tickets') @DeSucursal(...COCINA)
  tickets(@TenantActual() t: Tenant) { return this.p.tickets(t); }

  @Post('pedidos/:id/cocina') @HttpCode(200) @DeSucursal(...COCINA)
  cocina(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.p.cocina(t, a.sub, id, EstadoCocina.parse(b).estado); }

  @Patch('items/:id/cocina') @DeSucursal(...COCINA)
  async itemCocina(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const o = await this.p.pedidoDeItem(t, id);
    return this.p.cocina(t, a.sub, o, EstadoCocina.parse(b).estado, id);
  }
}

@Controller()
export class CajaController {
  constructor(@Inject(CajaService) private readonly c: CajaService) {}

  @Get('caja/actual') @DeSucursal(...CAJA)
  actual(@TenantActual() t: Tenant, @ActorActual() a: Actor) { return this.c.actual(t, a.sub); }
  @Post('caja/abrir') @HttpCode(200) @DeSucursal(...CAJA)
  abrir(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.abrir(t, a.sub, AbrirCaja.parse(b)); }
  @Post('caja/cerrar') @HttpCode(200) @DeSucursal(...CAJA)
  cerrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.cerrar(t, a.sub, CerrarCaja.parse(b)); }

  @Post('pedidos/:id/cobrar') @HttpCode(200) @DeSucursal(...CAJA)
  cobrar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.cobrar(t, a.sub, id, Cobro.parse(b)); }
  @Post('pagos/:id/anular') @HttpCode(200) @DeSucursal('owner', 'admin')
  anularPago(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) { return this.c.anularPago(t, a.sub, id, Motivo.parse(b).motivo); }

  @Get('recibos/:id') @DeSucursal(...CAJA, 'mesero')
  recibo(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.c.recibo(t, id); }
  @Get('pedidos/:id/recibo') @DeSucursal(...CAJA, 'mesero')
  reciboDePedido(@TenantActual() t: Tenant, @Param('id', ParseUUIDPipe) id: string) { return this.c.reciboDePedido(t, id); }

  @Get('sucursal/ajustes') @DeSucursal('owner', 'admin')
  ajustes(@TenantActual() t: Tenant) { return this.c.ajustes(t); }
  @Patch('sucursal/ajustes') @DeSucursal('owner', 'admin')
  cambiarAjustes(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() b: unknown) { return this.c.cambiarAjustes(t, a.sub, AjustesSucursal.parse(b)); }
}
