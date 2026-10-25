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
- Para el Portal: audiencia `gestro-portal` solo en el token de `portal-web`, y una entrada en `CATALOG` y `config.ts` del portal.

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

## 5. Pendiente en el Portal (F1c)
`GET /api/v1/portal/summary`, `GET /api/v1/portal/account`, `/entrar?destino=` ya existe en la web, «Cambiar de rol» y registro central de accesos en Kyros ID (el diseño del registro central aún no existe).
