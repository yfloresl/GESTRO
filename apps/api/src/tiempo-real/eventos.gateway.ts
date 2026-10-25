import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { BD, Bd } from '../database/database.module';
import { restaurantTables } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';

/** Salas: rest:{id} (personal de la sucursal), waiter:{userId} y table:{id} (solo el cliente de esa mesa). */
export const salas = { sucursal: (id: string) => `rest:${id}`, persona: (id: string) => `waiter:${id}`, mesa: (id: string) => `table:${id}` };

/** Huella corta del QR de la mesa: al regenerar el QR, las sesiones anteriores dejan de servir. */
export const huellaQr = (qrToken: string) => createHash('sha256').update(qrToken).digest('hex').slice(0, 12);

@Injectable()
@WebSocketGateway({ path: '/api/socket.io', cors: false })
export class EventosGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(SecretosService) private readonly secretos: SecretosService,
    @Inject(BD) private readonly bd: Bd,
  ) {}

  /**
   * El token va en el handshake. Personal (aud "staff"): solo entra a su persona y a SUS sucursales.
   * Mesa (aud "table"): solo entra a su mesa. Un token de un tipo no sirve para el otro.
   */
  async handleConnection(socket: Socket) {
    const token = String(socket.handshake.auth?.token ?? '');
    try {
      const staff = await this.jwt.verifyAsync<{ sub: string; rids?: string[] }>(token, { secret: this.secretos.firma('acceso'), algorithms: ['HS256'], audience: 'staff' }).catch(() => null);
      if (staff) {
        await socket.join(salas.persona(staff.sub));
        for (const rid of staff.rids ?? []) await socket.join(salas.sucursal(rid));
        return;
      }
      const mesa = await this.jwt.verifyAsync<{ rid: string; tid: string; qk: string }>(token, { secret: this.secretos.firma('mesa'), algorithms: ['HS256'], audience: 'table' });
      const [t] = await this.bd.select().from(restaurantTables).where(eq(restaurantTables.id, mesa.tid));
      if (!t || !t.active || t.restaurantId !== mesa.rid || huellaQr(t.qrToken) !== mesa.qk) throw new Error('mesa');
      await socket.join(salas.mesa(mesa.tid));
    } catch {
      socket.disconnect(true);
    }
  }

  emitir(sala: string, evento: string, datos: unknown): void { this.server?.to(sala).emit(evento, datos); }
}
