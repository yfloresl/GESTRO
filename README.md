# GESTRO

Sistema de Gestión de Restaurantes (SaaS multi-sucursal) de Kyros-Tech. Estándar Sistemas-Kyros, ingreso con Kyros ID y presencia en el Portal Kyros.

## Estado: F1 completa (F1a, F1b y F1c) sobre F0 · Fundaciones

| Hecho | Detalle |
|---|---|
| Monorepo | `apps/api`, `apps/web`, `packages/contracts`, `packages/sdk` |
| Base de datos | DDL probado de 66 tablas (53 `public` + 13 `fiscal`) como migración `0001`, con RLS forzada |
| Configuración sin variables | Llave maestra en volumen + `app_config` cifrada |
| Kyros ID | Canje del token (RS256, JWKS, `azp`/`aud`/`typ`/`exp`, `jti` de un solo uso), vínculo por `sub`, registro, código de invitación, back-channel logout |
| Sesión | Acceso 15 min en memoria + refresco opaco rotativo en cookie HttpOnly, con revocación de familia por reutilización |
| Guards | `JwtAuthGuard`, `RestaurantScopeGuard`, `RolesGuard`, `SubscriptionGuard` (402 en solo lectura), Throttler |
| Web | Tokens del diseño, shell (barra lateral, cabecera, menú de cuenta), ingreso, registro, panel mínimo |
| Despliegue | `docker-compose.yml` (db, api, gateway), Dockerfiles, nginx con CSP |

**F1a (hecho):** personal con código de invitación, menú y fotos (menú público por slug), áreas, mesas y QR imprimible, asignación de mesero, solicitudes de mesa en tiempo real (Socket.IO), escalamiento al encargado a los 3 min, avisos Web Push con pantalla bloqueada y PWA del cliente en `/m/<token>`.

**F1b (hecho):** toma de pedidos del personal (mesa, mostrador, llevar y delivery) con tickets diarios correlativos, notas y modificadores, anulación de platos con permiso y motivo, mover de mesa; pedido del cliente por QR (con confirmación del mesero o directo a cocina, configurable); tablero de cocina (KDS) en modo oscuro con cronómetro y alerta de demora, aviso al mesero cuando el pedido queda listo; caja con apertura y arqueo, cobro con recibo correlativo (no fiscal) o solo contabilizar, anulación de ventas con motivo.

**Pendiente de F1b por decisión de alcance:** dividir cuenta y juntar cuentas, promociones y descuentos, descuento de insumos al enviar (llega con recetas e inventario, F2), PIN de supervisor para anular y asientos contables (F3).

**F1c (hecho):** suscripción por sucursal con pago por QR bancario y **validación manual** del comprobante (la IA no interviene), meses de regalo y descuento por promoción, avisos a 5 días, 1 día y el día del vencimiento, gracia y modo solo lectura (402) sin perder datos; consola de plataforma para Kyros-Tech (pagos, sucursales, planes, promociones, QR e instrucciones de cobro); **tarjeta en el Portal Kyros** con `portal/summary` y `portal/account` (token del client `portal-web`, audiencia `gestro-portal`, CORS solo para el Portal, sin datos personales).

Siguiente: **F2 · Cocina y abastecimiento** (recetas, plan del día, inventario, compras). Ver `docs/ROADMAP.md`.

## Desarrollo local

```bash
pnpm install
pnpm db:arriba                      # Postgres 16 local en 127.0.0.1:5434, sin contraseña
pnpm dev:api                        # http://localhost:4000/api/v1  (docs en /api/docs)
pnpm dev:web                        # http://localhost:5173
node scripts/emisor-dev.mjs         # Kyros ID simulado en :4100 (solo desarrollo)
pnpm --filter @gestro/api exec tsx src/scripts/activar-kyros-id.ts --activo si --emisor http://localhost:4100/realms/kyros
pnpm test                           # RLS, acceso, guards, PKCE (contra Postgres real)
```

Los datos locales (llave maestra, base) quedan en `.datos/`, fuera del repositorio.

## Operación
Ver [`docs/OPERACION.md`](docs/OPERACION.md): despliegue en Coolify, activar Kyros ID, crear el superadmin, respaldos y lo que debe hacer Identidad.
