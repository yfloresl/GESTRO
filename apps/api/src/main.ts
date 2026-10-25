import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { FiltroDeErrores } from './comun/errores';
import { entorno } from './config/entorno';
import { aplicarMigraciones } from './database/migraciones';

export async function crearApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: entorno.produccion ? ['error', 'warn', 'log'] : undefined });
  app.set('trust proxy', 1); // detrás del gateway: IP real para los límites de uso
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useBodyParser('urlencoded', { extended: false, limit: '16kb' }); // back-channel logout
  app.useGlobalFilters(new FiltroDeErrores());
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  return app;
}

async function arrancar() {
  // Migraciones automáticas al arrancar (estándar Sistemas-Kyros).
  const hechas = await aplicarMigraciones(entorno.baseDeDatos);
  if (hechas.length) new Logger('Migraciones').log(`Aplicadas: ${hechas.join(', ')}`);
  const app = await crearApp();
  if (!entorno.produccion) {
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('GESTRO API').setVersion('0.1').addBearerAuth().build()));
  }
  await app.listen(entorno.puerto, '0.0.0.0');
  new Logger('GESTRO').log(`API en el puerto ${entorno.puerto}`);
}

if (require.main === module) void arrancar();
