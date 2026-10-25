# GESTRO

Sistema de Gestión de Restaurantes (SaaS multi-sucursal) de Kyros-Tech. Estándar Sistemas-Kyros, ingreso con Kyros ID y presencia en el Portal Kyros.

## Estado: F1a · Salón con QR (sobre F0 · Fundaciones)

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

Siguiente: **F1b** (toma de pedidos del personal, pedido por QR, KDS y recibos) y **F1c** (suscripción y pagos del SaaS con voucher manual, tarjeta en el Portal Kyros). Ver `docs/ROADMAP.md`.

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
