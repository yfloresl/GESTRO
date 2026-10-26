import { Body, Controller, HttpCode, Inject, NotFoundException, Post } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Actor, ActorActual } from '../comun/acceso';
import { SoloPlataforma } from '../comun/guards';
import { BD, Bd } from '../database/database.module';

const Entrar = z.object({ sucursalId: z.string().uuid() }).strict();

/**
 * Modo de soporte: el equipo de plataforma entra a una sucursal que no es suya para ayudar. Ve todas las secciones como lo haría el dueño pero
 * NO puede escribir nada (lo impide el servidor, no solo la pantalla). Cada ingreso queda en la auditoría de esa sucursal.
 */
@Controller('plataforma/soporte')
@SoloPlataforma()
export class SoporteController {
  constructor(@Inject(BD) private readonly bd: Bd) {}

  @Post('entrar') @HttpCode(200)
  async entrar(@ActorActual() a: Actor, @Body() b: unknown) {
    const { sucursalId } = Entrar.parse(b);
    const r = (await this.bd.execute(sql`SELECT id, name FROM restaurants WHERE id = ${sucursalId} AND status <> 'baja'`)).rows[0] as { id: string; name: string } | undefined;
    if (!r) throw new NotFoundException('Sucursal no encontrada.');
    await this.bd.execute(sql`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after) VALUES (${r.id}::uuid, ${a.sub}::uuid, 'soporte.ingreso', 'restaurant', ${r.id}::text, ${JSON.stringify({ modo: 'solo lectura' })}::jsonb)`);
    return { id: r.id, nombre: r.name };
  }
}
