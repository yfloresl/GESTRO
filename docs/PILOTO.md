# Piloto: qué está probado, qué falta y cómo ponerlo en marcha

Estado al 2026-10-26. «Probado» = con pruebas automáticas (242 en la API, 4 en la web) y/o recorrido en el navegador con datos de ejemplo.

## 1. Poner en marcha (en este orden)
1. **Coolify**: Docker Compose desde `yfloresl/GESTRO`, rama `main`, dominio `gestro.kyros-tech.com` solo en el servicio `gateway` (puerto 80). **Ninguna variable de entorno.** Ver `docs/DESPLIEGUE_COOLIFY.md`.
2. **Kyros ID**: en la terminal del contenedor `api`, `node dist/src/scripts/activar-kyros-id.js --activo si --emisor <url del realm> --client gestro-web`.
3. **Superadmin de plataforma**: `node dist/src/scripts/crear-superadmin.js --email <correo> --nombre "<nombre>"` (sin `--sub`: entrega un código de un solo uso de 24 h; se escribe en «Tengo un código de invitación» al entrar con Kyros ID).
4. **Clave de IA** (opcional): Plataforma → *Inteligencia artificial* → pegar la clave de Claude, *Probar conexión* y cargar los **precios vigentes** para estimar costos. Sin clave todo funciona; el asistente avisa que no está activo y el FODA se arma con reglas.
5. **Datos de ejemplo** (opcional, solo para presentar): crear un restaurante con «Crear mi cuenta» y correr `node dist/src/scripts/crear-datos-demo.js --sucursal <slug> --confirmo`. Solo funciona en una sucursal vacía; **no usarlo en un restaurante real**.
6. Cargar en Plataforma: planes, QR de cobro y promociones SaaS.

## 2. Probado
- Aislamiento por sucursal (RLS) en todas las tablas con `restaurant_id`, forzado; ninguna ruta devuelve datos de otra sucursal (hay pruebas por módulo).
- Permisos por rol en cada endpoint, cuerpos con `.strict()`, consultas parametrizadas, límites de frecuencia en lo público y en la IA.
- Dinero con decimal.js/NUMERIC; asientos de partida doble que cuadran; asientos publicados inmutables (lo impide la base); períodos cerrables.
- Estado de la base: migraciones reversibles (cada una aplicada, revertida y vuelta a aplicar).
- Instalación de producción (solo dependencias de producción): arranca y responde `/api/v1/ready`; ningún `require` fuera de `dependencies`.
- Recorrido en el navegador con 60 días de datos de ejemplo: estadísticas, proyección, alertas, FODA, eventos, contabilidad, reservas públicas y el resto de pantallas cargan sin errores.

## 3. Sin probar (necesita dispositivos, cuentas reales o servicios externos)
| Tema | Qué falta |
|---|---|
| Imagen Docker | No se pudo construir localmente (el motor de Docker no arrancó en la máquina de desarrollo). El primer despliegue en Coolify es la prueba; si el `api` no queda sano, mirar sus logs. |
| Web Push con pantalla bloqueada | Probar en un Android y en un iPhone (en iPhone, instalada como app en la pantalla de inicio). |
| Kyros ID real | Falta que Identidad cree el client `gestro-web` y la audiencia `gestro-portal`, y la tarjeta en el Portal. |
| IA real | Las pruebas usan un servidor de Anthropic simulado. Con la clave real: *Probar conexión*, un FODA y 3 preguntas al asistente. |
| Facturación SIN | No existe todavía: `factura` se rechaza con 422 y se opera con recibos. Va en otro repositorio. |
| Correo | No hay SMTP: el FODA mensual llega al panel, no al correo; las notificaciones de vencimiento son del panel y Web Push. |
| Impresión de recibos | Probar la hoja de 58/80 mm con la impresora real. |
| Respaldos | Definir respaldo de los volúmenes `gestro_pgdata` y `gestro_secretos` (sin el segundo, hay que volver a cargar integraciones y las sesiones se invalidan). |

## 4. Limitaciones conocidas (decisiones de alcance, no errores)
- Una sola instancia de API (el tiempo real y los trabajos periódicos corren dentro del proceso). Para escalar a varias hay que sumar Redis y un worker.
- Los trabajos periódicos (indicadores nocturnos, alertas cada 3 min, FODA mensual) son temporizadores del proceso: si el contenedor está apagado a esa hora, se ponen al día al volver a consultar (indicadores) o en el siguiente ciclo (alertas).
- Reservas web: una persona mal intencionada podría ocupar mesas con reservas falsas (límites por IP y por teléfono; el personal puede cancelarlas). Si molesta, activar «confirmar a mano».
- El cobro de una cuenta por cobrar en efectivo entra a la cuenta Caja de la contabilidad, pero no al arqueo del cajero.
- La nómina no genera asientos: el costo de personal queda en el reporte de turnos.
- División y unión de cuentas, PIN de supervisor, pago por QR dentro del pedido del cliente y mapa de mesas arrastrable quedan para después.
- Pendiente de diseño visual: no se hizo la comparación píxel a píxel con las 28 pantallas de Stitch (las pantallas se derivaron de los tokens; ver `.design/INVENTARIO.md`).
