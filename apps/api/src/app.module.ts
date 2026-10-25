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
import { MenuController, MenuPublicoController } from './menu/menu.controller';
import { MenuService } from './menu/menu.service';
import { CajaService } from './pedidos/caja.service';
import { CajaController, PedidosController } from './pedidos/pedidos.controller';
import { PedidosService } from './pedidos/pedidos.service';
import { PortalController } from './portal/portal.controller';
import { PlataformaController, SuscripcionController } from './suscripcion/suscripcion.controller';
import { SuscripcionService } from './suscripcion/suscripcion.service';
import { InventarioController } from './inventario/inventario.controller';
import { InventarioService } from './inventario/inventario.service';
import { RecetasController } from './recetas/recetas.controller';
import { RecetasService } from './recetas/recetas.service';
import { ComprasController } from './compras/compras.controller';
import { ComprasService } from './compras/compras.service';
import { ConsumoService } from './recetas/consumo.service';
import { PersonalController } from './personal/personal.controller';
import { PersonalService } from './personal/personal.service';
import { QrController, SolicitudesController, TableTokenGuard } from './qr/qr.controller';
import { SolicitudesService } from './qr/solicitudes.service';
import { SalonController } from './salon/salon.controller';
import { SalonService } from './salon/salon.service';
import { StorageService } from './storage/storage.service';
import { EventosGateway } from './tiempo-real/eventos.gateway';
import { PushController } from './tiempo-real/push.controller';
import { PushService } from './tiempo-real/push.service';
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
  controllers: [SaludController, AuthController, KyrosIdController, SucursalController, PersonalController, MenuController, MenuPublicoController, SalonController, QrController, SolicitudesController, PushController, PedidosController, CajaController, SuscripcionController, PlataformaController, PortalController, InventarioController, RecetasController, ComprasController],
  providers: [
    SesionService, KyrosIdService, JwtAuthGuard, StorageService, PersonalService, MenuService, SalonService, SolicitudesService, TableTokenGuard, EventosGateway, PushService, PedidosService, CajaService, SuscripcionService, InventarioService, RecetasService, ConsumoService, ComprasService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
})
export class AppModule {}
