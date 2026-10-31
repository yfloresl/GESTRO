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
Crea el usuario de plataforma y lo vincula de una vez. **Sin `--sub`** (no hace falta saberlo) entrega un **código de un solo uso, válido 24 horas**: la persona entra a GESTRO con Kyros ID y lo escribe en «Tengo un código de invitación»; queda vinculada por su identidad. No hay contraseñas. El resto de personas se vinculan con su código de invitación (un solo uso) o abren su propio restaurante con «Crear mi cuenta».

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

## 6. Inteligencia artificial (clave de Claude)
La clave **no va en variables de entorno**: se carga desde la consola de plataforma (Plataforma → *Inteligencia artificial*) con una cuenta de plataforma. Se guarda **cifrada** en la base (AES-256-GCM, llave maestra del volumen `gestro_secretos`), nunca se vuelve a mostrar (solo sus últimos 4 caracteres) y nunca sale en ninguna respuesta de la API.
- *Probar conexión* hace una llamada mínima. *Quitar clave* / *Apagar la IA* cortan el asistente y el FODA con IA al instante; el FODA sigue armándose con reglas y todo lo demás funciona igual.
- Modelos por tarea (por defecto `claude-sonnet-5-5` para FODA y asistente, `claude-haiku-5-5` para pruebas). **Carga los precios vigentes** de tu cuenta de Anthropic para que el costo se calcule: sin precios, el costo queda sin calcular y el límite mensual no se aplica.
- Topes: consultas por día por sucursal (200 por defecto) y gasto mensual de la plataforma (opcional). Cada llamada queda en `ai_jobs` (tarea, modelo, tokens, costo, estado).
- Qué recibe Claude: **solo agregados** (indicadores, totales, clases de menú); ni nombres ni teléfonos de personas. El texto del FODA se **valida contra los números** antes de publicarse. El asistente solo usa herramientas de **lectura** con la sucursal fijada por RLS; no hay SQL libre ni escritura.
- Pendiente: el envío del FODA mensual por correo (llega al panel; el correo espera a que se configure SMTP).

## 7. Datos de ejemplo para presentar el sistema
Para ver el sistema «lleno» (estadísticas, proyección, FODA, contabilidad, alertas), en una sucursal **nueva y vacía**:
```bash
node dist/src/scripts/crear-datos-demo.js --sucursal <slug> --confirmo
```
Carga 15 platos con receta, 19 insumos con stock, 2 proveedores, 8 mesas, 60 días de ventas (≈1 300 pedidos) con su consumo y costo, mermas, asientos contables, una promoción y un evento. Se niega si la sucursal ya tiene pedidos, platos, insumos o asientos. **No usar en un restaurante real.** No hay forma de «descargarlo»: para empezar de cero, crear otra sucursal.

## 8. Cuentas de demostración Prueba_Kyros
Identidad crea tres usuarios de Kyros ID con `sub` fijo y una contraseña pública de demostración (la misma en todos los sistemas del ecosistema). GESTRO las **pre-vincula** al cargar su restaurante de muestra:
| Usuario | `sub` | Rol en GESTRO |
|---|---|---|
| `prueba_kyros` | `3c183200-ca0f-483f-90fd-2cea6c0b0695` | dueño del restaurante de muestra |
| `prueba_kyros_asistente` | `92209c11-c4a6-40ce-ae54-e607ffc64891` | caja |
| `prueba_kyros_tutor` | `3969cf14-de90-458c-b2bc-d287adc1469b` | no se usa en GESTRO (siempre 401) |
| `prueba_kyros_gestro_mesero` | `0f4d6bd2-ab9b-482e-9e21-e0bf61a0b584` | mesero |
| `prueba_kyros_gestro_cocina` | `75ec2b33-5e9d-4712-895d-552cb49daf4b` | cocina |
| `prueba_kyros_gestro_almacen` | `cf1b7962-1bb4-4526-a563-e2d805e1ffa7` | almacén |
| `prueba_kyros_gestro_cobranzas` | `97c3f591-1fa7-4487-958a-8fa1f43dc556` | cobranzas |
| `prueba_kyros_gestro_contador` | `76f5c6e8-ff7e-40b5-b2c7-1ab52a0fca35` | contador |
| `prueba_kyros_gestro_area` | `0819aca5-6243-498f-a725-3069c40f0748` | encargado de área |

**Las seis cuentas por rol son nuevas: Identidad las crea con ESE `sub` fijo** (públicas con la clave demo, sin MFA; GESTRO no guarda contraseñas). Sirven para mostrar el menú de cada rol y el 403 sin permiso. En una demostración ya cargada, la dueña pulsa **«Restablecer mis datos de muestra»** y se crean las que falten.

La sucursal de muestra también trae: reservas en todos sus estados (con reserva web activa), ventas a crédito con cuentas por cobrar abiertas, vencidas, con abono y saldadas, una cuenta por pagar a proveedor, órdenes de compra (borrador, enviada, recibida), personal con turnos y asistencia, salón en vivo (4 pedidos abiertos, tablero de cocina, 2 llamados de mesa pendientes) y una suscripción con plan y un pago validado.

- **Cargar / quitar**: Plataforma → *Restaurante de muestra*. Crea la sucursal «Casa Andina» con menú y recetas, inventario, 60 días de ventas, contabilidad, una promoción y un evento. Debe estar activado Kyros ID (se vincula a su emisor). Quitarla borra sucursal, cuentas, vínculos y datos.
- **Sin restaurante de muestra cargado**, las tres cuentas dan **401** al entrar y en `portal/summary`/`portal/account` (como un token inválido); no pueden registrarse.
- **Solo lectura**: toda escritura devuelve 403 (también la ruta de pagos de suscripción), y la sucursal no recibe pedidos por QR, llamados ni reservas públicas. La única escritura permitida es **«Restablecer mis datos de muestra»** (solo el dueño, máximo una vez cada 5 minutos): borra y recarga SOLO esa sucursal y queda en `audit_log` (`demo.restablecida`). Exige que el usuario de la base sea superusuario (en el compose lo es).
- Nada de lo que se ve dice «demo»; los datos nunca se mezclan con restaurantes reales (hay una sola sucursal de muestra, marcada `is_demo`).

## 9. Modo soporte (equipo de plataforma)
Las secciones de GESTRO son **por sucursal**: un superadmin de plataforma sin sucursal propia solo ve «Panel» y «Plataforma Kyros». Para ayudar a una sucursal: Plataforma → *Sucursales* → **Entrar en modo soporte**. Ve todas las secciones como el dueño, pero el servidor **no deja escribir nada** (403) y cada ingreso queda en la auditoría de esa sucursal (`soporte.ingreso`). El banner superior permite salir. No ve otras sucursales mientras tanto.
Regla global «superadmin de Kyros ID en todos los sistemas» (rol `kyros-platform-admin` + 2º factor): **todavía no** implementada en GESTRO, a la espera del diseño común del ecosistema. Hoy el superadmin se da de alta una vez con un código de un solo uso (§3) y GESTRO no lee claims de rol ni `acr` del emisor.

## 10. Pendiente de integración con el Portal
`portal/summary`, `portal/account` y `/entrar?destino=` ya existen en GESTRO. Falta que Identidad cree el client y la audiencia (sección 2) y agregue la tarjeta al Portal. Quedan para cuando existan en el ecosistema: el registro central de accesos en Kyros ID (su diseño aún no existe) y `?rol=` en `/entrar` (hoy la persona cambia de sucursal desde el selector de la cabecera; sus roles son por sucursal).

## 11. SuperAdmin central de Kyros ID (interruptor APAGADO por defecto)
Quien tiene el rol `kyros-platform-admin` en Kyros ID (con TOTP) entra a GESTRO directo a la consola de plataforma, sin código de invitación. Diseño: `kyros-standards/docs/superadmin-central-standard.md`.
- **Encender / apagar** (en la terminal del contenedor `api`): `node dist/src/scripts/activar-kyros-id.js --activo si --client gestro-web --plataforma-sso si` (`no` lo apaga; sin la opción no cambia). Se activa recién después de desplegar Identidad y probar con la persona titular.
- Solo se lee el claim `kyros_pa` (exactamente `["kyros-platform-admin"]`) del access token ya verificado; `realm_access` se ignora.
- Se crea un único usuario SUPERADMIN por `sub` (correo reservado `pa-…@kyros-id.invalid`, sin contraseña, `is_platform_admin` NO se guarda: el privilegio es del claim vigente). Nunca se actualiza desde claims y nunca se promueve una cuenta existente. Tope: 5 identidades centrales.
- Crear exige `acr=1` y `auth_time` ≤ 5 min (si no, 401 `PLATAFORMA_REAUTH` y la web reinicia con `prompt=login` una sola vez). Reentrar acepta `acr` 0/1 y ≤ 10 h.
- La sesión dura como máximo 60 min absolutos (el refresco no la extiende) y no se renueva con el interruptor apagado o el vínculo retirado. El cierre de sesión global (back-channel) la revoca.
- Auditoría: `plataforma.ingreso_superadmin_central`, `plataforma.ingreso_superadmin_central_rechazado` (motivos `acr`, `auth_time`, `tope`, `sub_vinculado_a_cuenta_no_superadmin`, `cuenta_suspendida`) y `plataforma.sesion_central_revocada`.
- El código de un solo uso (`crear-superadmin.js`) sigue siendo el respaldo de emergencia. Dentro de una sucursal ajena rige el modo soporte (solo lectura).

## 12. Paquetes por módulo (entitlements)

Catálogo: Esencial USD 25 (menú y salón, caja y comandas, cierre diario), Profesional USD 49 (+ cocina con pantalla, inventario y recetas, reservas y cobranzas), Cadena USD 99 (+ varias sucursales, contabilidad, compras, delivery). Tipo de cambio 6.96. Sin límite por usuario; comensales y terceros (QR, reservas web, portal) nunca pagan ni se bloquean.

**Apagado por defecto**: un plan solo restringe cuando `features.aplicar = true`. Plataforma lo enciende por plan con `PATCH /plataforma/planes/:id/paquete {"aplicar":true}` (y lo apaga igual). Con el plan aplicado, las rutas de personal de un módulo no incluido responden 402 `PLAN_SIN_MODULO` («Tu plan no incluye …»). `GET /suscripcion/alcance` (todo el personal) dice qué incluye la sucursal. Plataforma y modo soporte no se bloquean. Pendiente: tope de sucursales por plan y ocultar en la web los módulos no incluidos.
