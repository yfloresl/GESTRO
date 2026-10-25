# Despliegue de GESTRO en Coolify

Estándar Sistemas-Kyros: Docker Compose, **sin variables de entorno**, dominio solo en `gateway`.

## Antes de empezar
- Registro DNS `A`: `gestro.kyros-tech.com` → IP de Kyros-Principal (`76.13.161.69`, la misma del Portal).
- Llave de solo lectura de GitHub en Coolify (si el repositorio es privado).
- Para entrar con Kyros ID en producción: Identidad debe haber creado el client `gestro-web` (ver `OPERACION.md` §2). El despliegue funciona sin eso; solo no se podrá ingresar hasta activarlo.

## Pasos
1. **Proyecto de Kyros-Tech → New Resource → Docker Compose** (no «Application» ni Dockerfile suelto).
2. Repositorio `yfloresl/GESTRO`, rama `main`, servidor **Kyros-Principal**, *Base directory* `/`, *Compose file* `/docker-compose.yml`.
3. **Dominio:** en el servicio `gateway` escribe `https://gestro.kyros-tech.com` (puerto 80). **Nunca** en `api` ni en `db`.
4. **Environment Variables:** no agregar ninguna.
5. **Deploy.** El orden lo fijan los chequeos de salud: `db` → `api` (aplica las migraciones al arrancar) → `gateway`.
6. **Verificar:**
   - `https://gestro.kyros-tech.com/api/v1/salud` y `/api/v1/ready` responden `{"ok":true}`.
   - La página raíz muestra «Ingresa a tu restaurante».
7. **Activar Kyros ID** (terminal del contenedor `api`):
   ```bash
   node dist/src/scripts/activar-kyros-id.js --activo si --emisor https://auth.kyros-tech.com/realms/kyros --client gestro-web
   ```
8. **Primer integrante de Kyros-Tech** (con el `sub` que entrega Identidad):
   ```bash
   node dist/src/scripts/crear-superadmin.js --email <correo> --nombre "<nombre>" --sub <sub>
   ```
9. Entrar a **Plataforma Kyros**: crear planes, cargar el QR de cobro y las instrucciones (ver `OPERACION.md` §5).

## Volúmenes (respaldar)
| Volumen | Contiene | Si se pierde |
|---|---|---|
| `gestro_pgdata` | Toda la base de datos | Se pierden los datos |
| `gestro_secretos` | Llave maestra (firma de sesión y cifrado de la configuración) | Las sesiones se invalidan y hay que recargar los secretos de integraciones; los datos no se pierden |
| `gestro_archivos` | Fotos de platos, comprobantes y QR de cobro | Se pierden las imágenes |

## Actualizar
No hay CI. Cada vez que se suba código: **Redeploy** en Coolify (o el webhook de GitHub de Coolify). Las migraciones corren solas al arrancar `api`; cada una es reversible.

## Si algo falla
- Build de `api` o `gateway`: revisa el log del build en Coolify (Node 22-slim y pnpm 11.11.0 vienen fijados en los Dockerfile).
- `api` no queda «healthy»: log del contenedor `api` (suele ser la base todavía arrancando o una migración).
- El ingreso falla con «Kyros ID no está disponible»: falta el paso 7 o el client en Identidad.
- Los avisos Web Push exigen HTTPS (el dominio de Coolify ya lo trae).
