import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Publico } from '../comun/acceso';
import { BD, Bd } from '../database/database.module';

@Controller()
export class SaludController {
  constructor(@Inject(BD) private readonly bd: Bd) {}

  /** Vivo. */
  @Publico() @Get('salud')
  salud() { return { ok: true }; }

  /** Dependencias listas (base de datos). El despliegue cambia el tráfico solo cuando esto responde 200. */
  @Publico() @Get('ready')
  async ready() {
    try { await this.bd.execute(sql`SELECT 1`); } catch { throw new ServiceUnavailableException({ ok: false }); }
    return { ok: true };
  }
}
