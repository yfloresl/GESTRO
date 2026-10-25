import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as webpush from 'web-push';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { BD, Bd } from '../database/database.module';
import { pushSubscriptions } from '../database/esquema';

interface Vapid { publicKey: string; privateKey: string }
export interface AvisoPush { titulo: string; cuerpo: string; url: string; etiqueta?: string; urgente?: boolean }

/**
 * Web Push (Android, y iPhone con la PWA instalada). Las claves VAPID se generan solas la primera vez
 * y se guardan cifradas en app_config: nada en variables de entorno.
 */
@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  private vapid: Vapid | null = null;

  constructor(@Inject(BD) private readonly bd: Bd, @Inject(ConfiguracionService) private readonly config: ConfiguracionService) {}

  private async claves(): Promise<Vapid> {
    if (this.vapid) return this.vapid;
    let v = await this.config.leer<Vapid>('webpush');
    if (!v) { v = webpush.generateVAPIDKeys(); await this.config.guardar('webpush', v, null); }
    this.vapid = v;
    return v;
  }

  async clavePublica(): Promise<string> { return (await this.claves()).publicKey; }

  async suscribir(userId: string, s: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<void> {
    await this.bd.insert(pushSubscriptions).values({ userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 200) })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth } });
  }

  async anular(userId: string, endpoint: string): Promise<void> {
    const subs = await this.bd.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    for (const s of subs) if (s.userId === userId) await this.bd.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
  }

  /** Envía a todos los dispositivos de la persona; los vencidos (404/410) se borran. Nunca lanza: el aviso es un extra. */
  async avisar(userIds: string[], aviso: AvisoPush): Promise<number> {
    if (!userIds.length) return 0;
    try {
      const v = await this.claves();
      let enviados = 0;
      for (const userId of new Set(userIds)) {
        const subs = await this.bd.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
        for (const s of subs) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(aviso),
              { vapidDetails: { subject: 'mailto:soporte@kyros-tech.com', publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 120, urgency: aviso.urgente ? 'high' : 'normal' });
            enviados++;
          } catch (e) {
            const estado = (e as { statusCode?: number }).statusCode;
            if (estado === 404 || estado === 410) await this.bd.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
            else this.log.warn(`No se pudo avisar (${estado ?? 'sin respuesta'})`);
          }
        }
      }
      return enviados;
    } catch (e) {
      this.log.warn(`Web Push no disponible: ${(e as Error).message}`);
      return 0;
    }
  }
}
