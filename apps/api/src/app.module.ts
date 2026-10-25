import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller';
import { SesionService } from './auth/sesion.service';
import { JwtAuthGuard } from './comun/guards';
import { ConfiguracionService } from './configuracion/configuracion.service';
import { DatabaseModule } from './database/database.module';
import { KyrosIdController } from './kyros-id/kyros-id.controller';
import { KyrosIdService } from './kyros-id/kyros-id.service';
import { SaludController } from './salud/salud.controller';
import { SucursalController } from './tenancy/sucursal.controller';
import { SecretosService } from './secretos/secretos.service';

@Global()
@Module({
  providers: [SecretosService, ConfiguracionService],
  exports: [SecretosService, ConfiguracionService],
})
class NucleoModule {}

@Module({
  imports: [
    NucleoModule, DatabaseModule, JwtModule.register({}),
    // Límite global; el login y el QR tienen límites propios con @Throttle.
    // En las pruebas (Vitest) se desactivan para que no se bloqueen entre sí.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => process.env.VITEST !== undefined }),
  ],
  controllers: [SaludController, AuthController, KyrosIdController, SucursalController],
  providers: [
    SesionService, KyrosIdService, JwtAuthGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule {}
