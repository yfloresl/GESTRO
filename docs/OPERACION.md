# Operación de GESTRO

## 1. Despliegue en Coolify (sin variables)
1. Recurso nuevo → **Docker Compose** → repositorio `yfloresl/GESTRO`, rama `main`, archivo `docker-compose.yml`.
2. Asignar el dominio `gestro.kyros-tech.com` **solo** al servicio `gateway` (puerto 80).
3. **No agregar ninguna variable.** Desplegar. Las migraciones corren solas al arrancar `api`.
4. Volúmenes a respaldar: `gestro_pgdata` y `gestro_secretos`. Perder el segundo invalida las sesiones y obliga a recargar los secretos de integraciones (clave de IA, SMTP); los datos no se pierden.
5. Estructura de salud: `GET /api/v1/salud` (vivo) y `GET /api/v1/ready` (base lista). El cambio de tráfico espera `ready`.

## 2. Kyros ID
Lo que debe hacer la sesión de **Identidad** (con aprobación del dueño), según `portal-standard.md` y `kyros-id-unico-standard.md`:
- Client **público** `gestro-web`: Code + PKCE S256, redirect exacta `https://gestro.kyros-tech.com/callback`, post-logout `https://gestro.kyros-tech.com/`, web origin `https://gestro.kyros-tech.com`, mapper de audiencia `gestro-web` en el token de acceso, `fullScopeAllowed` false.
- Back-channel logout hacia `https://gestro.kyros-tech.com/api/v1/auth/kyros-id/backchannel-logout`.
- Para el Portal: mapper de audiencia `gestro-portal` **solo** en el token de `portal-web` (nunca en `gestro-web`):
  ```json
  { "name": "aud-gestro-portal", "protocol": "openid-connect", "protocolMapper": "oidc-audience-mapper",
    "config": { "included.custom.audience": "gestro-portal", "access.token.claim": "true", "id.token.claim": "false", "introspection.token.claim": "true" } }
  ```
- Entrada en `portal/src/config.ts` (repo `kyros-identity`) y en `CATALOG`:
  ```ts
  { id: 'gestro', entryUrl: 'https://gestro.kyros-tech.com/entrar',
    summaryUrl: 'https://gestro.kyros-tech.com/api/v1/portal/summary',
    accountUrl: 'https://gestro.kyros-tech.com/api/v1/portal/account' }
  ```
  GESTRO acepta ese token solo en esas dos rutas (CORS únicamente para `https://portal.kyros-tech.com`, `no-store`, límite de 60 pedidos por minuto). Un token del Portal no abre ninguna otra ruta y un token de la app no abre estas.

Activar en GESTRO (terminal del contenedor `api`):
```bash
node dist/src/scripts/activar-kyros-id.js --activo si --emisor https://auth.kyros-tech.com/realms/kyros --client gestro-web
```

## 3. Superadmin de plataforma
Identidad entrega el `sub` de la persona. En la terminal del contenedor `api`:
```bash
node dist/src/scripts/crear-superadmin.js --email yamil@kyros-tech.com --nombre "Nombre" --sub <sub de Kyros ID>
```
Crea el usuario de plataforma y lo vincula de una vez. El resto de personas se vinculan con su código de invitación (un solo uso) o abren su propio restaurante con «Crear mi cuenta».

## 4. Avisos con pantalla bloqueada (Web Push)
- Las claves VAPID se generan solas la primera vez y quedan cifradas en `app_config`; no hay variables.
- **Android:** cada mesero abre GESTRO → Mesas & Salón → «Activar avisos».
- **iPhone (iOS 16.4 o superior):** primero deben instalar la app: Safari → Compartir → «Agregar a pantalla de inicio», abrirla desde el ícono y activar los avisos. Apple no deja que una web vibre; el sonido y la vibración de la notificación dependen de los ajustes del iPhone.
- Requiere HTTPS (el dominio de Coolify ya lo tiene). Redis no se usa todavía: el tiempo real corre en una sola instancia de `api`; se agrega Redis cuando se escale a más de una.

## 5. Suscripciones y consola de plataforma
1. Crear al primer integrante de Kyros-Tech (sección 3) y entrar a **Plataforma Kyros**.
2. **Planes:** crea los planes con su precio mensual (Kyros-Tech fija los montos; el sistema no trae ninguno) y asígnalos a cada sucursal en «Sucursales». Todo cambio manual pide un motivo y queda auditado.
3. **Cobro:** sube el QR bancario y escribe las instrucciones de pago (pestaña «Cobro»).
4. **Promociones:** por cantidad de meses, con meses de regalo y/o descuento y fechas de vigencia. Gana la que más meses regala y, a igualdad, la de mayor descuento.
5. **Validación:** cada pago llega con su comprobante a la vista. Se aprueba o se rechaza (con motivo) a mano. Al aprobar, la sucursal queda habilitada desde el mayor entre hoy y el día siguiente a su vencimiento, por los meses pagados más los de regalo. Una referencia bancaria no se puede repetir mientras no esté rechazada.
6. **Vencimiento:** el titular recibe aviso a 5 días, 1 día y el día en que vence. Pasado el periodo de gracia (3 días, provisional) la sucursal queda en solo lectura; pagar sigue funcionando.
- Los restaurantes nuevos arrancan con 15 días de prueba (provisional hasta que Kyros-Tech defina los planes).

## 6. Pendiente de integración con el Portal
`portal/summary`, `portal/account` y `/entrar?destino=` ya existen en GESTRO. Falta que Identidad cree el client y la audiencia (sección 2) y agregue la tarjeta al Portal. Quedan para cuando existan en el ecosistema: el registro central de accesos en Kyros ID (su diseño aún no existe) y `?rol=` en `/entrar` (hoy la persona cambia de sucursal desde el selector de la cabecera; sus roles son por sucursal).
