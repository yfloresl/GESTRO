# GESTRO — Documento de funcionamiento para QA

Versión: 2026-11-12 · Sistema: GESTRO (Kyros-Tech) · Base para el QA «como humano» del fin de semana.
Todo lo que figura aquí está verificado en el código o en pruebas locales; lo que no pudo verificarse está marcado **[sin verificar]**.

## 1. Qué es y a quién sirve
GESTRO es un sistema web (y app Android) para gestionar un restaurante: menú, mesas con QR, pedidos, cocina, caja, inventario, recetas, compras, reservas, cuentas por cobrar, personal, turnos, contabilidad básica y estadísticas. Idioma: español (la portada y los textos legales tienen versión en inglés). Moneda: bolivianos (Bs). Zona horaria: Bolivia.

Quién lo usa:
- **Dueño / administrador** (`owner`, `admin`): configura todo y ve todo.
- **Personal** con roles: `mesero`, `cajero`, `cocina`, `almacen`, `cobranzas`, `contador`, `area_manager` (encargado de área).
- **Comensales y terceros** (sin cuenta): escanean el QR de la mesa o reservan por la web. **Nunca pagan** y solo ven lo suyo.
- **Equipo de plataforma de Kyros-Tech** (SuperAdmin): consola de plataforma; no se usa en el QA de restaurantes.

## 2. Producto final vs lo pedido al inicio
| Requerimiento | Estado | Nota |
|---|---|---|
| Login único con Kyros ID (PKCE), vínculo por `sub` | Hecho | Sin contraseñas locales |
| Menú con fotos y QR por mesa; pedido y llamado del comensal | Hecho | |
| Salón: áreas, mesas, meseros por mesa/área/todo el restaurante | Hecho | |
| Pedidos (mesa, mostrador, llevar, delivery) y cocina (KDS) | Hecho | Delivery: tipo de pedido; no hay integración con apps de delivery |
| Caja: apertura/cierre, cobros, recibos | Hecho | Recibo interno, no factura |
| Facturación fiscal SIN/SIAT | Pendiente (fuera de alcance) | Servicio aparte |
| Pagos en línea (tarjeta/pasarela) | No existe | El cobro se registra, no se procesa |
| Inventario, recetas, costeo, plan del día | Hecho | |
| Compras, proveedores, cuentas por pagar | Hecho | |
| Cuentas por cobrar | Hecho | |
| Reservas (agenda + página pública) | Hecho | |
| Eventos y catering | Hecho | |
| Personal, turnos, asistencia | Hecho | |
| Promociones | Hecho | |
| Contabilidad básica (asientos automáticos, libros, balance) | Hecho | Libro mayor por cuenta o de todas |
| Estadísticas y panel del dueño | Hecho | |
| Alertas, FODA, asistente de IA | Parcial | IA solo si plataforma configura la clave **[sin verificar en producción]** |
| Planes por módulo y precios | Parcial | Catálogo hecho; la aplicación de límites y la sección pública están APAGADAS |
| Textos legales con aceptación obligatoria y evidencia | Hecho | Borradores: pendientes de revisión legal |
| Modo claro/oscuro | Hecho | Derivado de los tokens de diseño |
| Portal informativo en la raíz | Hecho | |
| App Android nativa | Hecho (APK debug) | Sin Play Store |
| Varias sucursales | Parcial | Comparación y consolidado; alta de sucursales adicionales **[sin verificar]** |
| Usuarios temporales de comensales | Pendiente | Diseño aprobado, espera piezas de Kyros ID |
| «Nada se borra» (deshabilitar en vez de DELETE) | Pendiente | Hoy hay borrados reales (ver §12) |

## 3. URLs
| Qué | URL |
|---|---|
| Portal informativo | https://gestro.kyros-tech.com/ |
| Ingreso (tarjeta con 2 botones) | /ingresar · acceso directo silencioso: /entrar |
| Completar registro | /registro (solo tras «Crear cuenta»; sin estado redirige a la portada) |
| Menú QR del comensal | /m/&lt;token-de-mesa&gt; |
| Reserva web | /r/&lt;slug-del-restaurante&gt; |
| Pantalla de cocina | /cocina |
| App del personal | /app (panel, salón, caja…) |
| Consola de plataforma | /app/plataforma (solo SuperAdmin) |
| Términos · Privacidad · Políticas | /terminos · /privacidad · /politicas · /legal/&lt;doc&gt; (es/en) |
| API pública (sin sesión) | /api/v1/public/legal/&lt;doc&gt;/vigente · /api/v1/public/&lt;slug&gt;/menu · /api/v1/public/planes (apagado) |
| Swagger | Apagado en producción |
| APK Android | `Adyton_Kyros/apk/gestro-debug.apk` (ver §13) |

## 4. Cómo registrarse (paso a paso)
1. Abre la portada `/`. Verás qué es GESTRO, para quién, funciones y capturas.
2. Pulsa **Crear cuenta** (o **Ingresar** si ya tienes cuenta Kyros ID). Te lleva a Kyros ID en la misma pestaña (PKCE).
3. En Kyros ID crea tu cuenta (sin segundo factor ni confirmación de correo). Vuelves a GESTRO en `/callback` y de ahí a «Completa tu registro».
4. Llena: nombre, correo de contacto, nombre del restaurante, razón social, NIT (opcional). Todos obligatorios salvo NIT.
5. Marca la casilla (**no viene marcada**): «He leído y acepto los Términos…». Cada documento se puede leer en un popup (**Leer**, ES/EN, Esc cierra). El botón «Abrir mi restaurante» queda deshabilitado hasta marcarla.
6. Entras al **Panel del Dueño** con 15 días de prueba. Se guarda la evidencia de aceptación (versión, fecha/hora, huella de IP y navegador).
7. Si cambia la versión de los textos, la próxima vez aparece «Actualizamos nuestros términos» y hay que aceptar de nuevo.

**Personal invitado:** el dueño crea a la persona en *Personal* y obtiene un **código de un solo uso** → la persona entra con su Kyros ID → «Tengo un código de invitación» → pega el código, marca la casilla legal → queda unida a su usuario y rol.

Validaciones del registro: nombre 2–120 caracteres, correo válido, restaurante 2–120, razón social 2–160, NIT ≤30. Un correo o identidad ya registrada da error 409.

## 5. Cómo ingresar por rol (cuentas de prueba)
Las cuentas de demostración existen solo con la demostración cargada (la carga la hace plataforma). Contraseña pública de demo (estándar Kyros): `Kyros12345678!`. Ingreso: portada → **Ingresar** → usuario y contraseña en Kyros ID.

| Usuario en Kyros ID | Rol | Qué ve al entrar |
|---|---|---|
| `prueba_kyros` | Dueño/administrador | Panel del Dueño, todo el menú |
| `prueba_kyros_asistente` | Caja (`cajero`) | Caja |
| `prueba_kyros_gestro_mesero` | Mesero | Mesas y salón |
| `prueba_kyros_gestro_cocina` | Cocina | Pantalla de cocina `/cocina` |
| `prueba_kyros_gestro_almacen` | Almacén | Inventario |
| `prueba_kyros_gestro_cobranzas` | Cobranzas | Cuentas por cobrar |
| `prueba_kyros_gestro_contador` | Contador | Primera sección de su menú (Recetas) |
| `prueba_kyros_gestro_area` | Encargado de área | Mesas y salón |
| `prueba_kyros_tutor` | — | Siempre rechazado (no es de GESTRO) |

La sucursal de demostración se llama «Casa Andina» y es de **solo lectura**: se puede recorrer todo; cualquier escritura devuelve «Esta cuenta es solo de lectura». Botón **«Restablecer mis datos de muestra»** (solo dueño, máximo cada 5 min) recarga los datos. Para probar escrituras hay que **registrar un restaurante propio** (§4).

## 6. Mapa de pantallas y menú por rol
Menú lateral (✓ = visible):

| Sección (ruta `/app/…`) | Dueño | Caja | Mesero | Cocina | Almacén | Cobranzas | Contador | Área |
|---|---|---|---|---|---|---|---|---|
| Panel del Dueño (`panel`) | ✓ | | | | | | | |
| Menú & Fotos (`menu`) | ✓ | | | ✓ | | | | |
| Recetas & Costeo (`recetas`) | ✓ | | | ✓ | ✓ | | ✓ | |
| Plan del día (`plan-del-dia`) | ✓ | | | ✓ | ✓ | | | |
| Inventario & Almacenes (`inventario`) | ✓ | | | ✓ | ✓ | | ✓ | |
| Pedidos (`pedidos`) | ✓ | ✓ | ✓ | | | | | ✓ |
| Cocina KDS (`/cocina`) | ✓ | | | ✓ | | | | |
| Caja (`caja`) | ✓ | ✓ | | | | | | |
| Mesas & Salón (`salon`) | ✓ | ✓ | ✓ | | | | | ✓ |
| Compras & Proveedores (`compras`) | ✓ | | | | ✓ | | ✓ | |
| Eventos & Catering (`eventos`) | ✓ | ✓ | | ✓ | ✓ | | ✓ | ✓ |
| Reservas (`reservas`) | ✓ | ✓ | ✓ | | | | | ✓ |
| Personal (`personal`) | ✓ | | | | | | | |
| Turnos & Asistencia (`turnos`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Suscripción (`suscripcion`) | ✓ | | | | | | | |
| Promociones (`promociones`) | ✓ | ✓ | | | | | ✓ | ✓ |
| Cuentas por cobrar (`cobranzas`) | ✓ | ✓ | | | | ✓ | ✓ | |
| Contabilidad & Libros (`contabilidad`) | ✓ | | | | | | ✓ | |
| Informe FODA (`foda`) | ✓ | | | | | | ✓ | |
| Asistente (`asistente`) | ✓ | | | | | | ✓ | |
| Alertas (`alertas`) | ✓ | | | | | | ✓ | ✓ |
| Estadísticas & BI (`estadisticas`) | ✓ | | | | | | ✓ | ✓ |
| Configuración (`configuracion`) | ✓ | | | | | | | |

Reglas: una ruta no permitida muestra «No tienes acceso a esta sección» (el servidor además responde 403). Cabecera: selector de sucursal, selector claro/oscuro, menú de usuario (Mi cuenta Kyros, Portal, Términos, Privacidad, Cerrar sesión). Cerrar sesión cierra también la cuenta Kyros ID.

## 7. Funciones: pasos, datos de ejemplo y reglas
**Importante:** en la demo todo es de solo lectura; para escribir usa un restaurante propio.

### 7.1 Menú & Fotos
- Crear categoría («Platos de fondo») y plato: nombre, precio > 0 (máx. 2 decimales), descripción, categoría, disponible sí/no; foto JPG/PNG/WebP (se valida por contenido; SVG rechazado).
- Resultado: el plato aparece en el menú QR público y en el POS. Validación: nombre vacío o precio ≤ 0 → error.

### 7.2 Mesas & Salón
- *Configurar salón* (solo dueño/admin, sección plegable): **Nueva área** (nombre, p. ej. «VIP»; sugerencias: Terraza, Aire acondicionado, Fumadores…), **Nueva mesa** (número, asientos 1–50, área opcional), **mesero por área / todo el restaurante / por mesa**, **imprimir QR**, **regenerar QR** (invalida el anterior).
- Mapa de mesas: pestañas por área; cada mesa muestra Libre/Ocupada/Llamado/Cuenta; clic abre el detalle (llamados con «Atendido», enlace al pedido).
- Llamados en vivo (sonido y notificaciones si se activan). Duplicados: nombre de área repetido → 409.

### 7.3 Menú QR del comensal (`/m/<token>`)
- Escanear el QR → ver menú con precios y fotos → armar pedido → enviar; botones «Llamar al mesero» y «Pedir la cuenta» (uno pendiente por tipo; repetir da «Ya avisaste al mesero»).
- Si el restaurante no recibe pedidos por QR: «llama al mesero». Un pedido ya servido no se reabre desde el QR.

### 7.4 Pedidos
- «Nuevo pedido»: tipo (mesa / mostrador / llevar / delivery), mesa, cliente/teléfono/dirección según tipo; agregar platos con cantidad y notas; «Todo enviado» manda a cocina; anular ítem (con PIN/permiso); mover de mesa.
- Estados: abierto → enviado → en preparación → listo → servido → cobrado. Un solo pedido abierto por mesa (se juntan lo del QR y lo del mesero).
- Al enviar a cocina se descuenta inventario según receta (porciones × cantidad × merma).

### 7.5 Cocina (KDS, `/cocina`)
- Tablero Nuevo / En preparación / Listo; tiempos (objetivo 15 min, rojo si pasa); marcar avance; al quedar todo listo avisa al mesero. «Salir» cierra sesión; «Volver» solo dueño/admin.

### 7.6 Caja
- **Abrir caja** (efectivo inicial ≥ 0) → cobrar pedidos (efectivo, tarjeta, QR, crédito) → recibo (imprimible 80 mm) → **cerrar caja** con arqueo (efectivo esperado vs contado). Sin caja abierta no se cobra («Abre tu caja antes de cobrar»).
- Crédito: exige cliente (nace una cuenta por cobrar).

### 7.7 Inventario & Almacenes
- Pestañas: Existencias (filtros Agotado/Stock bajo/Óptimo, búsqueda, ficha por fila, «Mostrar más» cada 50), Movimientos (compra, merma, ajuste, traspaso), Kardex, Conteo físico, Insumos y almacenes. Regla: el stock solo cambia por movimientos; cantidades positivas; merma exige motivo.

### 7.8 Recetas & Costeo
- Por plato: insumos y cantidades con unidad; costo y margen automáticos con el último costo; alerta si margen < mínimo (60 % por defecto). Sub-recetas (salsas) producen un insumo.

### 7.9 Plan del día
- Elegir platos y porciones → calcula insumos requeridos y faltantes → sugiere compra.

### 7.10 Compras & Proveedores
- Proveedores (nombre, días de entrega y de pago); órdenes de compra (borrador → enviada → parcial/recibida); recepción sube stock y genera cuenta por pagar y asiento; pestaña «Por pagar».

### 7.11 Reservas
- Agenda por día (flechas, «Hoy»); **Nueva reserva**: nombre (≥2), teléfono (≥6, opcional), fecha, hora, personas 1–100, mesa (auto si se deja vacía), notas ≤300. Acciones: Confirmar, Sentar, Terminó, No llegó, Cancelar. Clic en el nombre abre la **ficha** de la reserva.
- Reserva web (`/r/<slug>`): disponible si el dueño la habilita; horario, duración y máximo de personas configurables; código de reserva (XXX-XXX) para cancelar.

### 7.12 Cuentas por cobrar
- Lista con saldo y vencimientos; clic en el cliente abre su **ficha** (todas sus cuentas); **Cobrar** total o parcial (monto ≤ saldo; vía caja o bancos) genera el asiento.

### 7.13 Eventos & Catering, Promociones, Personal, Turnos
- Eventos: nombre, fecha, menú del evento, estado. Promociones: nombre, alcance (plato/horario/día), % descuento 1–100, vigencia.
- Personal (dueño): alta con nombre, correo y roles; desactivar; código de invitación. Turnos: funciones, programación semanal, marcar entrada/salida, costo de personal.

### 7.14 Contabilidad & Libros
- Plan de cuentas, asientos (manual: partida doble, debe = haber; los del sistema son automáticos), períodos (cierre), reportes: Sumas y saldos, **Libro mayor** (por cuenta o «Todas las cuentas»), Flujo de caja, Libros de ventas y compras. Los asientos publicados no se editan.

### 7.15 Estadísticas, Panel, Alertas, FODA, Asistente
- Panel del Dueño: Ventas del día (o de ayer si hoy no hay), Ticket promedio, Plato estrella, Margen, Ocupación, Ventas por hora y Alertas; cada recuadro abre su detalle en un panel.
- Estadísticas: períodos 7/30/90 días; pestañas Resumen, Ventas, Menú, Proyección, Sucursales. Alertas: stock bajo y por vencer.
- Asistente/FODA: usan IA solo si plataforma configuró la clave **[sin verificar en producción]**; si no, muestran que no está disponible.

### 7.16 Suscripción y Configuración
- Suscripción (dueño): estado, días, calcular meses, declarar pago con comprobante (imagen) y referencia; plataforma lo valida. Vencida → **solo lectura** (402 al escribir; se puede pagar).
- Configuración: ajustes de la sucursal (modo de cobro: recibo / solo contabilizar, etc.).

### 7.17 Textos legales
- Popups «Leer» en registro y en la pantalla de actualización; pie «Términos · Privacidad · Políticas» en portada, ingreso y registro; menú de usuario. Páginas completas `/legal/<doc>` con selector ES/EN. Son **borradores**.

## 8. Flujos extremo a extremo (para el QA)
1. **Alta y primer uso:** portada → Crear cuenta → registro (con casilla) → Panel → Menú: crear categoría y 2 platos → Salón: crear área y 2 mesas → copiar/ver QR.
2. **Servicio de una mesa:** abrir `/m/<token>` en otra ventana (móvil) → pedir → en `/app/pedidos` ver el pedido → enviar a cocina → `/cocina` marcar listo → caja: abrir caja → cobrar → recibo.
3. **Llamado:** desde el QR «Llamar al mesero» → alerta en Mesas & Salón → «Atendido».
4. **Reserva:** `/r/<slug>` (habilitar antes en Reservas → «Reservas por la web») → reservar → aparece en Reservas → Confirmar → Sentar.
5. **Inventario y compra:** Inventario: crear insumo y receta → vender → ver descuento → Plan del día → orden de compra → recibir → stock y «Por pagar».
6. **Crédito:** cobrar con método crédito → Cuentas por cobrar → cobro parcial → asiento en Contabilidad.
7. **Personal:** Personal → nuevo mesero → copiar código → otra sesión con otra cuenta Kyros → «Tengo un código».
8. **Legal:** cambiar la versión (solo en desarrollo) → «Actualizamos nuestros términos».

## 9. Integraciones con otros sistemas
- **Kyros ID** (ingreso, registro, cierre global): obligatorio.
- **Portal Kyros-Tech:** entrada con `/entrar`; el Portal ve el resumen de la cuenta vinculada.
- **Tipo de cambio de Kyros-Tech** (`/api/v1/tipo-cambio`): solo para mostrar precios en Bs en «Planes y precios» (apagado).
- **FacturaSIN, Glucora:** no integrados todavía (la llamada servicio-a-servicio está en preparación: catálogo de secretos listo, llamada pendiente).
- Notificaciones web push (opcionales por persona).

## 10. Validaciones generales y errores esperables
- Todos los cuerpos se validan en servidor; campos desconocidos → 400.
- Sin sesión 401; sesión sin permiso 403; sucursal ajena 403; suscripción vencida (escritura) 402; demo (escritura) 403; módulo no incluido en el plan (si se activa) 402 `PLAN_SIN_MODULO`.
- Ingreso fallido: mensaje uniforme «No pudimos verificar tu ingreso». Límite de 10 intentos/min por IP en ingreso y registro.
- Dinero: 2 decimales máximo; textos largos se rechazan por límite.

## 11. Límites conocidos
- La demo es de solo lectura: el QA de escrituras requiere un restaurante propio.
- Los textos legales son borradores sin revisión de abogado.
- El APK es debug (certificado de depuración); la sesión de Kyros ID vive en el navegador del sistema y «Cerrar sesión» en la app no la cierra allí.
- Sin facturación fiscal, sin pagos en línea, sin envío de correos/WhatsApp.
- Un restaurante nuevo empieza sin áreas ni mesas: hay que crearlas.
- Cerrar la pestaña del KDS no pierde datos; sin internet la app muestra una pantalla de error.

## 12. Lo que NO hace
No emite facturas SIN; no cobra tarjetas ni QR por el restaurante; no envía correos ni WhatsApp; no tiene app en tiendas; no se integra con apps de delivery ni bancos; no sustituye a un contador. **Hoy algunas acciones borran de verdad** (platos, categorías, insumos, promociones, turnos, asientos en borrador, ítems de pedido): la regla «nada se borra» (deshabilitar) está pendiente.

## 13. App Android
- Archivo: `C:\Users\YamilFL\Desktop\Proyectos con IA\Adyton_Kyros\apk\gestro-debug.apk` (paquete `com.kyros.gestro`, Android 5.1+).
- Instalar en emulador (Android Studio): arrancar un AVD (API 34 con Google APIs) → `adb install -r gestro-debug.apk` (o arrastrar el APK al emulador) → abrir **GESTRO**.
- Ingreso: «Ingresar» abre Kyros ID en el navegador del sistema (Custom Tabs); al terminar vuelve a la app por `com.kyros.gestro://callback`. Requiere que la web con el puente nativo esté desplegada en gestro.kyros-tech.com.
- Reconstruir: ver `apps/android/README.md` (JDK 17 + Android SDK 34; `node apps/android/scripts/build-apk.mjs`).

## 14. Checklist rápido para el QA
1. Portada en escritorio y móvil, claro/oscuro, ES/EN; botones Ingresar/Crear cuenta; enlaces legales abren popup y vuelven con Esc.
2. Registro completo con casilla desmarcada (botón bloqueado) y marcada.
3. Cada cuenta de prueba (§5): menú correcto, rutas prohibidas bloqueadas (§6).
4. Cada formulario con datos válidos, vacíos y en el límite (§7).
5. Flujos de §8 con un restaurante propio.
6. Errores: sin sesión (borrar cookie), suscripción vencida (solo plataforma), demo de solo lectura.
