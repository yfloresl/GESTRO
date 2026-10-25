import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import type { Tenant } from '../database/database.module';
import { CambioPersonal, NuevoPersonal, PersonalService } from './personal.service';

/** Personal de la sucursal: alta con rol y código de invitación para unir su Kyros ID. */
@Controller('personal')
export class PersonalController {
  constructor(@Inject(PersonalService) private readonly personal: PersonalService) {}

  @Get() @DeSucursal('owner', 'admin')
  listar(@TenantActual() t: Tenant) { return this.personal.listar(t); }

  @Post() @DeSucursal('owner', 'admin')
  crear(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Body() body: unknown) { return this.personal.crear(t, a.sub, NuevoPersonal.parse(body)); }

  @Post(':id/codigo') @HttpCode(200) @DeSucursal('owner', 'admin')
  codigo(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.personal.nuevoCodigo(t, a.sub, id); }

  @Patch(':id') @DeSucursal('owner', 'admin')
  cambiar(@TenantActual() t: Tenant, @ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) { return this.personal.cambiar(t, a.sub, id, CambioPersonal.parse(body)); }
}
