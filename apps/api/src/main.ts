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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { analizadorAviso, esAviso } from './facturacion-kyros/aviso-cuerpo';
import { IntegracionFacturaSinService } from './facturacion-kyros/integracion-fs.service';

export async function crearApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: entorno.produccion ? ['error', 'warn', 'log'] : undefined });
  app.set('trust proxy', 1); // detrás del gateway: IP real para los límites de uso
  app.setGlobalPrefix('api/v1');
  // R1 (integracion FacturaSIN): cada peticion mantiene al dia la URL publica derivada (Host/X-Forwarded-*); nada de variables de entorno.
  // Aviso de FacturaSIN: lleva la factura completa y su XML (puede pasar de los 100 kB por defecto). Se admite hasta 2 MB SOLO en esa ruta y se conserva el cuerpo crudo para verificar la firma.
  app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => (esAviso(req.method ?? '', (req as { path?: string }).path ?? req.url ?? '') ? analizadorAviso(req, res, next) : next()));
  const integracionFs = app.get(IntegracionFacturaSinService);
  app.use(((req: never, _res: unknown, next: () => void) => { void integracionFs.observar(req); next(); }) as never);
  app.use(cookieParser());
  app.useBodyParser('raw', { type: ['image/jpeg', 'image/png', 'image/webp'], limit: '4mb' }); // foto de plato, voucher y QR de cobro
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
