import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BD, Bd } from '../database/database.module';
import { appConfig } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';

/** Configuración del sistema (SMTP, clave de IA, QR de cobro, Kyros ID...), cifrada en la base. */
@Injectable()
export class ConfiguracionService {
  constructor(@Inject(BD) private readonly bd: Bd, @Inject(SecretosService) private readonly secretos: SecretosService) {}

  async leer<T>(clave: string): Promise<T | null> {
    const [fila] = await this.bd.select().from(appConfig).where(eq(appConfig.clave, clave));
    return fila ? (JSON.parse(this.secretos.descifrar(fila.valorCifrado)) as T) : null;
  }

  async guardar(clave: string, valor: unknown, por: string | null): Promise<void> {
    const valorCifrado = this.secretos.cifrar(JSON.stringify(valor));
    await this.bd.insert(appConfig).values({ clave, valorCifrado, actualizadoPor: por })
      .onConflictDoUpdate({ target: appConfig.clave, set: { valorCifrado, actualizadoPor: por, actualizado: new Date() } });
  }
}
