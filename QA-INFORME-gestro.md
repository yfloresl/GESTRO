# QA-INFORME-gestro — GESTRO (2.5, restaurantes)

Rama `qa/gestro-2026-11-14` (worktree `wt/gestro`, base `eeca8a6`). Evidencia: `QA-EVIDENCIA/gestro/`. Estado: **EN CURSO** (turno 1: rol caja).
Cuenta usada: `prueba_kyros_asistente` (Prueba Kyros Asistente, rol Cajero, sucursal «Casa Andina», demo en modo QA). Ingreso por SSO sin formulario, verificado en pantalla.

## 1. Resumen parcial
- Rol caja probado a fondo: apertura y cierre de caja, pedido de mesa con modificadores, cobro con los 5 métodos (efectivo, QR, tarjeta, transferencia, crédito), recibo, cuentas por cobrar (cobro parcial y excedido), bloqueo por URL.
- Cálculos verificados al céntimo (ver matriz). Un error real de cuadre de caja (GST-001, Alta), corregido en la rama.
- Lo no probado todavía está en la sección 9.

## 2. Semáforo (parcial)
| Área | Estado |
| --- | --- |
| Caja (apertura/cierre/arqueo) | Amarillo → verde tras GST-001 |
| Pedidos y cobro | Amarillo (sin vuelto, propina ni descuento; sin cantidad +/-) |
| Cuentas por cobrar | Verde (cálculos exactos) tras GST-001 |
| Permisos por URL (rol caja) | Verde |
| Salón y mesas | Verde (mapa de 8 mesas, llamados, avisos) |
| Reservas | Verde: validaciones (vacío, 0 y 500 personas, hora pasada) y flujo Confirmada → En la mesa → Terminó; asignó Mesa 8 sola. Cancelar no probado (cuadro nativo) |
| Promociones (solo lectura del cajero) | Verde: «Happy hour» 20 % lun-vie 17-19, hoy sábado «fuera de horario» |
| Turnos y eventos | No probado aún |
| Responsive, tema, idioma, accesibilidad, seguridad, legal | No probado aún |

## 3. Recorrido de neófito (rol cajero, primera vez)
Entré y caí directo en «Caja»: título claro, banner verde «Restaurante de pruebas (modo QA)», un solo campo «Efectivo inicial (Bs)» con 0. Escribí -50 y el navegador mostró un globo genérico «Utilice un formato que coincida con el solicitado» (no dice qué formato). Con 200,50 abrió, pero **no apareció ningún aviso de «caja abierta»**: solo cambió la pantalla.
En «Pedidos» las 4 tarjetas de demostración decían «hace 18970 min» (13 días en minutos): no se entiende. «Nuevo pedido» → elegí Mesa 1; si no elijo mesa el aviso es «Seleccione un elemento de la lista». El menú es claro (cuadrícula con precio). Toqué «Sopa de maní» dos veces rápido y solo entró una; después entró bien, pero **cada toque agrega una línea «1×»**: no hay botones de + y − para cantidad, solo «Quitar». El icono de lápiz de cada plato abre modificadores (sin cebolla, punto medio…), nota para cocina y tiempo: muy bueno. «Enviar a cocina (6)» habilita «Cobrar». El cobro ofrece Efectivo/QR/Tarjeta/Transferencia/Crédito y Recibo / Solo contabilizar, con la aclaración honesta de que la factura SIN aún no está disponible. **No pregunta cuánto entrega el cliente ni calcula el vuelto, y no hay propina ni descuento.** Tras cobrar, el recibo (N° 000001, «NO ES UNA FACTURA») se ve bien.
Al cerrar la caja el sistema usa un cuadro nativo del navegador («¿Cerrar la caja?…»): se ve distinto al resto del sistema.

## 4. Hallazgos
| ID | Área | Sev. | Descripción | Pasos | Esperado / obtenido | Evidencia | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GST-001 | Caja / Cuentas por cobrar | **Alta** | El efectivo cobrado a un cliente de crédito («Efectivo (entra a la caja)») no entra al «Efectivo esperado» del arqueo: el cierre muestra un sobrante falso. | Caja abierta 200,50; cobrar Bs 218 en efectivo y vender Bs 80 a crédito; en Cuentas por cobrar cobrar Bs 30,25 en efectivo; ir a Caja y cerrar contando lo que hay en el cajón (448,75). | Esperado: esperado 448,75, diferencia 0,00. Obtenido: esperado 418,50 y «Diferencia: Bs 30.25 (sobrante)». | `GST-001-cierre-caja-sobrante-falso.jpg`; código `apps/api/src/pedidos/caja.service.ts` (`resumen`), `cobranzas/cobranzas.service.ts` (`cobrar`) | **Corregido y verificado en vivo** (commit f442547): caja abierta 100,00 + cobro de cuenta en efectivo 10,00 → «Efectivo esperado Bs 110.00» (captura `GST-001-despues-esperado-110-con-cobro-de-cuenta.jpg`) |
| GST-002 | Pedidos | Baja | La antigüedad se muestra en minutos sin escalar («hace 18970 min»). | Pedidos → tarjetas del demo. | «hace 13 días». | captura de Pedidos | **Corregido** (commit f442547, `haceCuanto`); sin ver en pantalla: las tarjetas de demo ya estaban cobradas |
| GST-003 | Caja / Cobro | Media | Cuadros nativos `confirm()`/`prompt()` para cerrar caja, pagar a proveedores («Monto a pagar»), cerrar períodos, borrar, etc.: estilo ajeno al sistema, no se pueden estilizar ni traducir y bloquean al navegador (congelaron mi pestaña). El pago a proveedor usa `prompt()` para un monto. | Caja → Cerrar caja. | Diálogo propio del sistema. | `apps/web/src/paginas/Caja.tsx:24`, `Compras.tsx:168` y otros 14 usos | Propuesta |
| GST-004 | Cobro | Media | El cobro no pide «efectivo recibido» ni muestra el vuelto; no hay propina ni descuento manual en el cobro. Un cajero real necesita el vuelto. | Pedido → Cobrar. | Campo «Recibido» y vuelto; propina opcional. | captura del cobro | Propuesta (regla de negocio) |
| GST-005 | Pedidos | Media | Cada toque agrega una línea «1×» suelta; no hay + / − de cantidad. Para bajar una cantidad hay que quitar líneas una por una. | Pedido → tocar dos veces el mismo plato. | Una línea «2×» con controles. | captura del pedido | Propuesta |
| GST-006 | Formularios | Baja | El campo «Efectivo inicial» valida con `pattern` del navegador: el mensaje es el genérico «Utilice un formato que coincida con el solicitado». | Escribir -50 y Abrir caja. | «Escribe un monto válido, por ejemplo 200,50». | captura | Pendiente |
| GST-008 | Reservas | Baja | La hora por defecto de «Nueva reserva» es 13:00 aunque ya haya pasado: el primer intento de un usuario apurado termina en «Esa hora ya pasó.» (el mensaje del servidor sí es claro). | Reservas → Nueva reserva → llenar y guardar. | Hora por defecto = próxima hora libre. | `GST-008-reserva-hora-por-defecto-ya-paso.jpg` | Pendiente |
| GST-009 | Caja | Baja | En el cuadro «Cobros del turno» la etiqueta «Cobros de cuentas por cobrar (efectivo)» envuelve el importe en dos líneas. | Caja con un cobro de cuenta. | Etiqueta corta. | `GST-001-despues-esperado-110-con-cobro-de-cuenta.jpg` | Pendiente |
| GST-007 | Caja | Baja | Abrir caja, cobrar y cobrar cuenta no muestran aviso de éxito (la pantalla cambia sin mensaje). | Abrir caja. | Aviso «Caja abierta». | — | Pendiente |

## 5. Correcciones aplicadas
- `f442547` en main (desplegado 14/11 ~16:10, salud 200, bundle `index-i7Mp8ATL.js`): GST-001 (migración aditiva 0024 `receivable_collections` con RLS y reversa; `CajaService.resumen` suma el efectivo cobrado a clientes de crédito; prueba nueva `pedidos.spec.ts` «GST-001»; pedidos 19/19, contabilidad 15/15, rls y catering 18/18; typecheck api y web sin errores) y GST-002.
- Verificación en vivo de GST-001: ver tabla de hallazgos.

## 6. Matriz de verificación de cálculos
| # | Cálculo | Fórmula esperada | Fuente | Casos probados | Resultado |
| --- | --- | --- | --- | --- | --- |
| 1 | Total de pedido | Σ cantidad × precio (menú) | Aritmética | Mesa 1: 28+14+18+28+52+78 = 218,00; Mesa 3: 52+28 = 80; Mesa 2: 2×78+2×10 = 176; Mesa 4: 2×56+2×14 = 140; Mesa 6: 60+18 = 78 | Correcto en pantalla (centavo a centavo) |
| 2 | Efectivo esperado | apertura + ventas en efectivo (+ cobros de cuentas en efectivo) | Práctica de arqueo | 200,50+218,00 = 418,50 | Correcto sin cuentas; **GST-001** al cobrar cuentas en efectivo |
| 3 | Cierre de caja | contado − esperado | Práctica de arqueo | 448,75 − 418,50 = +30,25 | Aritmética correcta; el esperado estaba incompleto (GST-001) |
| 4 | Cuentas por cobrar | saldo = monto − pagado; por cobrar = Σ saldos; vencido = Σ saldos con fecha < hoy | Aritmética | 31 cuentas: Σ saldos 1.988,00; vencido 1.655,00; cobro parcial 30,25 sobre 80,00 → saldo 49,75; cobro de 80,01 rechazado «El cobro supera el saldo (Bs 80.00)» | Correcto |
| 5 | IVA incluido (venta con factura) | IVA = importe × 13 / 113 | Ley 843 art. 4 y 15 (IVA 13 % sobre el precio final) — norma pendiente de confirmar con fuente oficial en este turno | Código `ivaIncluido` (asientos.ts); la factura no se emite aún: solo se prueba con prueba automática | Pendiente verificación con norma |
| 6 | IT del período | IT = (ventas + débito fiscal) × tasa | Ley 843 art. 72-77 — pendiente de confirmar | Código `contabilidad.service.ts` línea 481 | Pendiente (requiere rol contador) |
| 7 | Promociones | precio = lista × (100 − %)/100, redondeo HALF_UP a 2 decimales, nunca sube | Aritmética | Código `promociones/motor.ts` | Pendiente de probar con rol caja |

## 7. Propuestas
- Modal propio para confirmaciones y montos (GST-003).
- Efectivo recibido y vuelto en el cobro (GST-004).
- Controles de cantidad (+/−) en el pedido (GST-005).

## 8. Notas de rendimiento y pruebas
- Cargas de página lentas medidas en el navegador con otros ejecutores activos: `sucursal`, `legal/estado` y `caja/actual` tardaron ≈12 s cada una (una sola vez, no reproducido con curl: `/api/v1/salud` 0,4 s). Sospecha de saturación local, no confirmada.
- Rutas por URL con rol caja: `/app/panel`, `/app/inventario` → pantalla «No tienes acceso a esta sección… Ir a mi inicio» (verde). Las demás rutas guardadas por rol se probarán con el rol correspondiente.
- Entrada HTML en notas de cocina: «<b>» se muestra literal (escapado correctamente).
- Los cuadros `confirm()` nativos congelan la pestaña del navegador automatizado hasta cerrarla (ver GST-003).

## 9. Lo no probado aún (se completa al cerrar)
Turnos, eventos; anulación de ventas y cancelar reserva (confirmación nativa); borrado; vista celular, tema claro/oscuro, idioma, accesibilidad; consola de errores; cierre de sesión; responsive, tema, idioma, accesibilidad; consola y red; roles mesero, cocina, almacén, cobranzas, contador, área, dueño; legal, seguridad, Android.

## 10. Residuos (para el cierre del dueño)
- Demo `prueba_kyros_asistente`: caja del día abierta y cerrada con diferencia (GST-001), 5 pedidos de demo cobrados (Mesas 1, 2, 3, 4, 6), cuenta por cobrar «QA Cliente Crédito Pérez» con saldo 49,75. Se limpia con «Restablecer mis datos de muestra».
- Interruptores demo encendidos: ninguno.

---

# GESTRO 2.5 — prueba de RECHAZO con `prueba_kyros_tutor` (14/11/2026 ~15:35)

Cuenta: `prueba_kyros_tutor` (sesión de Kyros ID abierta; no existe como usuario de GESTRO: "siempre rechazada"). Entré desde https://gestro.kyros-tech.com/ingresar → "Entrar con Kyros ID" (SSO sin formulario).
- **Qué ve un neófito (antes):** tras la espera de "Verificando tu ingreso…" queda en `/callback` con el texto "HTTP 401" y el botón "Volver a intentar": no dice qué pasó ni qué hacer. Hallazgo **GST-R01 (Media, usabilidad)**.
- **Sesión a medias:** ninguna. `localStorage` y `sessionStorage` vacíos tras el rechazo; no se guardó token. Las llamadas de la web: `GET /api/v1/auth/kyros-id/config` 200 → `POST /auth/refrescar` 401 → `POST /auth/kyros-id/sesion` 401 (el servidor rechaza porque el `sub` es una cuenta de demostración sin vínculo y la demo de GESTRO no la acepta: `kyros-id.service.ts`, `esSubDeDemostracion`; el texto del servidor es uniforme "No pudimos verificar tu ingreso." para no revelar nada).
- **Bucles:** ninguno. "Volver a intentar" lleva a `/`; abrir `/app/caja` sin sesión redirige a `/` (portada) sin rebotar. Una sola ronda de reautenticación existe solo para el administrador de plataforma (`gestro.reauth`).
- **Desde la API:** sin sesión, `GET /api/v1/pedidos`, `/caja/actual` y `/sucursal` → 401 "Sesión requerida"; `POST /auth/kyros-id/sesion` con un token de 1 carácter → 400 validación; con un `Bearer` inválido `POST /auth/refrescar` → 401. No hay acceso. (No se probó con el token real de la cuenta: prohibido manejar tokens.)
- **Corrección (GST-R01, commit 7264a1c):** `Callback.tsx` muestra para 401: "Esta cuenta no puede entrar a GESTRO. Si es la primera vez, vuelve al inicio y elige «Crear mi cuenta» (o pide una invitación al administrador de tu restaurante); si es una cuenta de prueba, usa una cuenta con acceso."; 403 desactivada; 503 Kyros ID; 429 demasiados intentos; y nunca "HTTP nnn". Prueba `Callback.spec.ts` (3). Verificación en vivo: pendiente del despliegue (repetir el ingreso con `prueba_kyros_tutor` cuando GESTRO se haya redesplegado).
- Nota: la cuenta rechazada deja el aviso en español solamente (el callback de GESTRO no está traducido; la portada y los legales sí).

## Consola de plataforma (qa_superadmin) — 14/11, ejecutor FASE B consolas
- Ingreso SSO OK; `/app/plataforma` como «QA Superadmin (temporal)» / «Plataforma Kyros-Tech». **No hubo puerta legal** para esta cuenta (probable exención de cuentas de plataforma: `legal.ts` `exenta()`, no verificado). Código: `VERSION_LEGAL = '2026-11-06'` en el worktree, distinta de la 2026-11-14.x de los demás sistemas (verificar en main).
- Recorrido de solo lectura (sin cambios): Pagos (pendientes/aprobados/rechazados: vacío), Sucursales (1: Casa Andina SRL, plan «Sin plan» en selector, habilitada hasta 2036-10-27, activa, botones «Entrar en modo soporte» y «Suspender»), Planes (Esencial Bs 174,00; Profesional Bs 341,04; Cadena Bs 689,04 = 25/49/99 USD × 6,96, recalculado OK), Promociones (vacía), Cobro (sin QR), IA (sin clave, 0 consultas), Integraciones (secreto «NO CONFIGURADA», solo escritura), Restaurante de muestra (cargada, modo QA con escritura «Activado»; no se tocó el interruptor ni «Restablecer cuentas demo»).
- GS-C01 (bajo, texto): la tarjeta «Restaurante de muestra» dice «Es de solo lectura» y a la vez «modo QA con escritura: Activado»: contradictorio para un neófito. GS-C02 (bajo): «cuentas Prueba_Kyros» con mayúscula rara; el nombre en cabecera dice «(temporal)» sin explicar. GS-C03 (bajo): la pestaña Sucursales muestra «Cargando…» un par de segundos sin indicador.
- **GS-C04 (medio, cálculo, por código + recálculo en Node): pérdida de días en renovaciones mensuales sucesivas.** `suscripcion.service.ts:187-189`: inicio=max(hoy, vence+1) y nuevo vence = inicio + N meses − 1 con `make_interval`, sin ancla de día. Caso: desde 31/01, 1 mes → 27/02; renueva: inicio 28/02 → 27/03; 28/03 → 27/04 … tras 5 renovaciones de 1 mes vence 27/06 frente a 29/06 con ancla (31/01+5m−1): se pierden 2 días. Caso del dueño (vence 30/12, renueva 10/12, 1 mes → 30/01) sí es correcto. Corrección propuesta: guardar el día ancla (como Medyx `addMonthsAnchored`) y añadir pruebas; no aplicada. Planes apagados, así que impacto actual nulo. HOY usa America/La_Paz (correcto).
- Cambio de plan (`AjusteSucursal.planId`): solo cambia el plan, sin prorrateo/crédito (queda para cuando se activen los planes).

---

# Código y cálculos (turno de código sin sesión, 14/11/2026 ~18:00) — rama `qa/gestro-2026-11-14`

Todo lo de esta sección está **implementado y probado en local (pruebas automáticas)**; nada de esto se ha visto todavía en pantalla en vivo (sin sesión de navegador en este turno). Resultado de pruebas al final de la sección.

## C1. Suscripciones: GS-C04 (corregido en código)
- **Causa:** `aprobar` calculaba `inicio + N meses − 1` con `make_interval` sin día ancla; desde el 31/01, cada mes corto desplazaba los períodos siguientes y se perdían días.
- **Corrección:** módulo puro nuevo `apps/api/src/suscripcion/periodos.ts` (calendario propio en fechas AAAA-MM-DD, sin Date ni UTC) y columna aditiva `restaurants.billing_anchor_day` (migración 0025, con reversa). Reglas: renovar antes de vencer (o el mismo día) suma a continuación del período vigente; renovar una vencida empieza hoy (hora de La Paz); el día ancla se conserva (31/01, 28/02, 31/03, 30/04…); un ajuste manual de fecha reinicia el ancla.
- **Cambio de plan** (`ajustarSucursal`): si quedan días pagados se conserva el VALOR pagado: `diasNuevos = floor(días restantes × precio viejo ÷ precio nuevo)`; el resto (menos de un día del plan nuevo) se registra como crédito en centavos en la auditoría (BigInt, base anual 12/365). Si el crédito no alcanza para 1 día: 409 y se pide fecha manual con motivo. **Limitación:** el crédito sobrante queda solo en la auditoría (no hay saldo a favor aplicable a un pago futuro: propuesta). Suspensión y reactivación solo cambian `status`, no tocan `paid_until`, así que no se pierden días pagados.
- **Recálculo independiente** (`test/periodos.puro.spec.ts`, 11 pruebas): calendario propio contra `Date.UTC` en 5 años; ancla 31/01→28/02→31/03→30/04; bisiesto 2028 (31/01/2028 + 1 mes = 29/02); **cinco renovaciones mensuales desde 31/01 terminan 29/06** (antes 27/06) y 24 renovaciones terminan 30/01/2028; caso del dueño (vence 30/12, renueva 10/12, 1 mes → 30/01); renovación de vencida; 12 meses = días exactos del año; prorrateo (20 días de Bs 174,00 → 10 días de Bs 341,04, crédito Bs 2,29; 10 días de 341,04 → 19 días de 174,00); 400 casos aleatorios (nunca se entrega más valor del pagado). Prueba con BD en `suscripcion.spec` («GS-C04 cambio de plan»).
- **Hora de Bolivia:** el «hoy» de la suscripción ya usaba `America/La_Paz` (verificado). Corregidos: fin de la prueba gratuita de 15 días (usaba UTC), rango «hasta hoy» de contabilidad (UTC) y fecha por defecto de Contabilidad en la web. Nuevo `comun/tiempo.ts` (`hoyBolivia`); pruebas 19:59, 20:00, 23:59, 00:00, fin de mes/año y 29/02/2028 (`tiempo.puro.spec.ts`). El resto de «hoy» del código ya resta 4 h (revisado por búsqueda en api y web).
- **GS-C01** corregido (la tarjeta ya no dice «solo lectura» a secas: explica que depende del interruptor). **GS-C02**: «cuentas Prueba_Kyros» → «cuentas de prueba»; el «(temporal)» del nombre viene de Kyros ID, no de GESTRO. **GS-C03** («Cargando…» sin indicador): sin cambio, pendiente (no localicé ese texto en `Plataforma.tsx`).

## C2. Cobro y pedidos: GST-004, GST-005, GST-003, GST-006 a GST-009
- **GST-004 (regla de negocio aplicada por orden del dueño):** `Cobro` acepta `descuento` (con `motivoDescuento` obligatorio de 3 letras o más), `propina` y `efectivoRecibido`. Cálculo en `pedidos/cobro-calculo.ts` con decimal.js (centavos exactos): total = subtotal − descuento; a cobrar = total + propina; vuelto = recibido − a cobrar. Topes: descuento hasta 30 % del subtotal, propina hasta 30 % del total (constantes `DESCUENTO_MAX_PCT` y `PROPINA_MAX_PCT`: **decisión de negocio que el dueño puede ajustar**), sin propina en crédito, efectivo recibido solo con efectivo y debe cubrir lo que se cobra. La pantalla de cobro hace el mismo cálculo en centavos enteros (`lib/cobro.ts`) y muestra subtotal, descuento, total, propina, a cobrar y vuelto; el servidor manda.
- **Contabilidad de la propina:** no es ingreso ni lleva IVA/IT: el asiento debita caja/bancos por total + propina, acredita ventas (y débito fiscal) por el total y acredita la cuenta nueva `2.1.05 Propinas por entregar` (pasivo; se crea sola en sucursales con plan anterior). El efectivo esperado de la caja incluye la propina cobrada en efectivo (el vuelto no cuenta: solo lo realmente cobrado). Estadísticas y alertas siguen usando `amount` (ventas sin propina). Migración aditiva 0026 (`tip_amount`, `discount_amount`, `cash_received`, `change_given`, `orders.discount_reason`). El recibo muestra descuento, propina, recibido y vuelto.
- **GST-005:** `PATCH /items/:id/cantidad` (1 a 99, solo platos sin enviar; 409 si ya se envió); en pantalla, controles − y + por línea, y un toque sobre un plato ya pedido (sin notas) suma a la misma línea en vez de crear otra «1×».
- **GST-003:** los 25 `confirm()` y `prompt()` nativos (16 archivos) se reemplazaron por `componentes/Dialogos.tsx` (`confirmar()` y `pedirTexto()`): `role="alertdialog"`, `aria-modal`, foco atrapado y devuelto, Esc cancela, Enter acepta, foco inicial en «Cancelar» si la acción es peligrosa, botones con nombre propio. El pago a proveedor pide el monto y luego «banco o efectivo» con botones nombrados (antes «Aceptar = bancos»).
- **GST-006:** el campo de monto muestra «Escribe un monto válido, por ejemplo 200,50…». **GST-007:** aviso «Caja abierta. Ya puedes cobrar.» al abrir caja. **GST-008:** la hora por defecto de una reserva de hoy es la próxima media hora (hora de Bolivia). **GST-009:** etiqueta corta «Cobros de cuentas (efectivo)».

## C3. Matriz de verificación de cálculos
| # | Cálculo | Fórmula / fuente | Casos (recálculo independiente) | Resultado |
| --- | --- | --- | --- | --- |
| 1 | Total de pedido | Σ cantidad × precio (promoción decidida en el servidor) | Turno 1 (218; 80; 176; 140; 78); cantidad 3 × 65,50 = 196,50 | Correcto |
| 2 | Descuento, propina, vuelto | ver C2 | 5000 casos aleatorios contra aritmética entera; bordes del tope (48,90 / 48,91); efectivo 154,99 vs 155,00 | Correcto |
| 3 | Efectivo esperado de caja | apertura + efectivo + propina en efectivo + cobros de cuentas en efectivo | 100 + 150 + 5 = 255,00, cierre 255 → diferencia 0,00; GST-001 (130,25) | Correcto |
| 4 | IVA 13 % «por dentro» | IVA = importe × 13 ÷ 113, half-up 2 decimales. Ley 843 art. 15 (alícuota 13 %) y art. 5 (el impuesto integra el precio), consultado en fuentes secundarias (lexivox.org, boliviaimpuestos.com). Ley 1733 («por fuera») NO en vigor (orden del dueño) | Factura de 113,00 → ventas 100,00 + débito fiscal 13,00 (`cobro.puro.spec`); GESTRO aún no emite factura: solo contabiliza | Correcto en el código; **no verificado** contra la Gaceta Oficial |
| 5 | IT 3 % | IT = (ventas + débito fiscal) × 3 % (base = ingresos brutos con IVA). Ley 843 arts. 72 y 75 (3 % sobre ingresos brutos), fuentes secundarias | Lectura de código (`contabilidad.service.ts`, `impuestos`) | **No verificado** si el IVA integra la base ni el acreditamiento IVA/IT; la cifra se rotula «referencial» |
| 6 | Propina (asiento) | pasivo, sin IVA/IT | 113,00 + 10,00: caja 123,00 = ventas 100,00 + débito 13,00 + propinas 10,00 | Correcto; criterio contable propio: confirmar con un contador |
| 7 | Suscripción: días | ver C1 | 11 pruebas puras + 1 con BD | Correcto |
| 8 | Planes en Bs | USD × 6,96 | 25/49/99 → 174,00 / 341,04 / 689,04 (turno de consola) | Correcto |
| 9 | Costo de recetas, merma, inventario valorado, estadísticas | costo promedio, kardex | Cuentas por cobrar al céntimo en el turno 1 (1.988,00 / vencido 1.655,00); el resto sin recálculo independiente en este turno | **No verificado** (pendiente) |

## C4. Seguridad, privacidad y legal
- **Legal:** textos finales es/en (Términos, Privacidad, Políticas) versión **2026-11-14.1**: titular Kyros-Tech S.R.L., Santa Cruz de la Sierra, administracion@kyros-tech.com, sin NIT, mayoría de edad 18 años, respuesta a derechos en 15 días hábiles, conservación (fiscal y contable no menos de 8 años, mensajes de contacto 2 años, el resto el tiempo necesario), jurisdicción de Santa Cruz de la Sierra, sin país ni ubicación de servidores; sin leyendas de borrador ni TODO. Normativa citada y verificada por búsqueda: Constitución Política del Estado arts. 21 y 130, Ley 164 y Ley 453 (sin números de artículo; se declara que Bolivia aún no tiene ley integral de datos personales). Se reemplazó «ningún dato se borra, sin plazo» por plazos definidos. Puntos de abogado/negocio: limitación de responsabilidad (§11) y reembolsos (§7) son genéricos.
- **Reaceptación también en la API:** nuevo `LegalGuard` global: quien no aceptó la versión vigente recibe 403 `LEGAL_REQUIRED` al escribir (POST, PUT, PATCH, DELETE); lectura, `/legal`, `/auth`, `/public` y `/portal` quedan libres. Exentas (comprobado en `legal.ts`): administradores de plataforma, cuentas demo y subs de demostración, igual que la web. Prueba en `legal.spec`.
- **Cierre por inactividad** (nuevo): aviso a los 25 min y cierre local a los 30 min, sin forzar `prompt=login` al volver (el ingreso normal sigue con `max_age` de 8 h, cubierto por `kyrosid.spec`); `/cocina` queda exenta (tablero que se deja encendido).
- **«Nada se borra»:** antes de cada DELETE físico (platos y categorías del menú, insumos, promociones, funciones de personal, turnos, asientos borrador, platos sin enviar) se guarda la copia completa en `archived_records` (migración 0027, RLS, con quién y cuándo). **No es un borrado lógico con indicador en cada consulta** (habría tocado unas 55 consultas): es archivo con respaldo restaurable a mano; falta pantalla de restauración. Los DELETE existentes ya rechazan lo que tiene historial. Quitar un rol de personal y las suscripciones push siguen siendo físicos (no son datos del negocio).
- **Revisado sin cambios:** cabeceras del gateway (CSP en modo de bloqueo, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) ya presentes; límites de tasa del QR de mesa (6 a 20 por minuto), reservas públicas (6 por minuto al crear, 10 al cancelar), ingreso y refresco; guards por rol y sucursal con RLS forzada. **No ejecutado en este turno:** `pnpm audit`, pruebas de enumeración en vivo de `/m/[token]` y `/r/[slug]`, aislamiento entre restaurantes con cuentas reales.

## C5. Qué comprobar en pantalla, por cuenta
- `prueba_kyros_asistente` (caja): cobro con descuento 10 y motivo, propina 5 y efectivo recibido (ver vuelto); línea «Propinas cobradas» en Caja; cerrar caja con el modal nuevo; recibo con vuelto; − y + en el pedido.
- `prueba_kyros_gestro_mesero`: tocar dos veces el mismo plato (una línea 2×), − y +, «Quitar»; cancelar reserva con modal; hora por defecto de la reserva.
- `prueba_kyros_gestro_cocina`: `/cocina` no se cierra por inactividad.
- `prueba_kyros_gestro_almacen`: «Mínimo» y «Renombrar almacén» con el modal (coma decimal), ajuste de stock.
- `prueba_kyros_gestro_cobranzas`: cobrar una cuenta (aviso y arqueo).
- `prueba_kyros_gestro_contador`: asiento de una venta con propina (cuenta 2.1.05), cerrar período y anular asiento con modal, IVA/IT referencial.
- `prueba_kyros_gestro_area` y `prueba_kyros` (dueño): borrar plato, promoción o turno con modal; Legal en es/en versión 2026-11-14.1.
- `qa_gestro_dueno_1`, `qa_gestro_caja_1`, `qa_gestro_mesero_1`: reaceptación al primer ingreso con la versión nueva; escrituras reales.
- `qa_superadmin`: Sucursales → cambiar de plan con días pagados (ver `prorrateo` en la respuesta y la auditoría); aprobar un pago y comprobar el vencimiento; texto de «Restaurante de muestra».


**Resultado de pruebas (local, BD en puerto 5439):** API 26 archivos / 293 pruebas verdes (1 omitida); pruebas puras 17; web typecheck y api typecheck sin errores; web 17 pruebas verdes.

## C6. GST-010: topes de descuento y propina configurables (decisión del dueño 14/11/2026, en main `eeead80`)
**Qué se hizo.** Los topes dejaron de ser fijos (30 %). Ahora son dos valores por restaurante (`restaurants.discount_max_pct` y `tip_max_pct`, NUMERIC(5,2), por defecto 30; migración aditiva **0028** con reversa). El servidor los lee dentro de la transacción de cada cobro (efecto inmediato en todas las cajas, sin caché); la pantalla de cobro los consulta en `GET /cobro/topes` (cajero, dueño, administrador) y solo los repite.
- **Pantalla:** Configuración (solo dueño/administrador) → «Límites al cobrar: descuento y propina». Texto para neófitos, ejemplo en vivo con un pedido de Bs 100,00, validación 0–100 con hasta 2 decimales (acepta coma o punto), 0 = opción bloqueada. Al subir un límite pide un motivo obligatorio. Muestra el último cambio (quién, cuándo, valores anteriores, motivo). En el cobro, el texto «Máximo X %» y los botones de propina 5/10 % se ajustan al tope vigente.
- **Servidor:** `PATCH /sucursal/ajustes` {descuentoMaxPct, propinaMaxPct, motivoCambioTopes}: rechaza <0, >100, más de 2 decimales y no numéricos (400); subir sin motivo (mínimo 3 letras) es 400; solo owner/admin (403 a cajero). Cada cambio escribe en la MISMA transacción una fila `sucursal.topes_cobro` en la auditoría con `before`, `after`, motivo y usuario: no se puede cambiar sin dejar rastro.
- **Cálculo:** descuento máximo = ⌊subtotal × % / 100⌋ al centavo; propina máxima = ⌊total × % / 100⌋ (centavos; mismo algoritmo en servidor con decimal.js y en pantalla con enteros en centésimas de %). 100 % de descuento sigue sin poder dejar el pedido en cero.
**Verificación de cálculos (recálculo independiente en BigInt).** API: 6000 casos aleatorios con topes {0; 0,01; 5; 10; 12,5; 29,99; 30; 33,33; 50; 99,99; 100} contra aritmética BigInt entera (total, a cobrar, vuelto) y, por caso, 1 centavo sobre el tope rechazado; pantalla: 20 000 casos equivalentes; casos fijos: 12,5 % de 100,00 = 12,50 (12,51 rechaza), 12,5 % de 163,00 = 20,375 → 20,37 (20,38 rechaza), 50 % de 163,00 = 81,50. Todo coincide. 
**Pruebas por archivo:** `cobro.puro.spec.ts` (API, 6 pruebas), `cobro.spec.ts` (web, 8), `pedidos.spec.ts` con PostgreSQL local (23/23, incluida la nueva «GST-010»: valores inválidos, 403, motivo al subir, auditoría con antes/después, efecto inmediato en el siguiente cobro, otro restaurante sin cambios). `tsc` limpio en API y web.
**Despliegue (14/11 ~19:10):** salud 200; un 503 de ~1 minuto durante el relevo de contenedor; luego `GET /api/v1/cobro/topes` y `/sucursal/ajustes` sin sesión responden 401 (la ruta nueva existe). Verificación con sesión: pendiente (sin navegador en esta pasada).
**Qué comprobar en pantalla (con sesión):** `qa_gestro_dueno_1` → Configuración → «Límites al cobrar»: dejar 30 y 30, subir descuento a 50 sin motivo (el botón queda apagado), con motivo «Prueba de socios» guardar; ver «Último cambio». Con `qa_gestro_caja_1`: abrir caja, cobrar un pedido de Bs 163,00 con descuento 81,50 (acepta) y 81,51 (muestra «no puede pasar del 50 %»). Volver a 30/30 (bajar no pide motivo). Un cajero no ve Configuración.
**Recorrido para socios:** el cambio y su motivo quedan en la auditoría del restaurante; no se borró nada.
Interruptores: ninguno. Candado liberado; PostgreSQL local detenido (puerto 5441).


## Barrido legal (14/11/2026, ubicación de servidores y marcas de borrador)
LIMPIO: privacidad habla de proveedores necesarios (infraestructura, Kyros ID) sin ubicación. En vivo /api/v1/public/legal = 2026-11-14.1. Sin cambios. Decisión del dueño: ningún texto legal menciona país ni ubicación de servidores/proveedores ni afirma transferencias internacionales. Barrido por código (es/en/pt, API, semillas, generadores, estáticas) y verificación en vivo sin sesión. Reaceptación comprobada solo por código y por el cambio de versión servido (sin cuenta de prueba: no se pulsó Ingresar).


---

# FASE B con sesión: dueño `prueba_kyros` (14/11/2026 ~20:50–21:30, hora de Bolivia)

Sesión: «Prueba Kyros / Dueño» en Casa Andina (verificado en cabecera), SSO sin formulario. Pestaña propia. No se pulsó «Restablecer cuentas demo» ni se borró nada.

## Resultados verificados EN PANTALLA
| Prueba | Resultado |
| --- | --- |
| Panel del Dueño | Ventas del día 692,00 = 218+80+176+140+78 (OK); ticket 138,40 = 692/5 (OK). Menú lateral: 23 entradas. |
| **GST-010 topes** (Configuración) | 101 → «Escribe un número entre 0 y 100, con hasta 2 decimales». Subir a 50 muestra el ejemplo en vivo («descontar hasta Bs 50,00») y exige motivo; guardó y mostró «Último cambio: 14/11/2026, 8:53:18 p. m. por Prueba Kyros (antes 30 % y 30 %) · motivo: Prueba de socios QA». |
| Efecto en el siguiente cobro | El cobro dice «Máximo 50 % del pedido (lo define el dueño en Configuración)». Pedido Bs 170,00: descuento 85,00 aceptado; **85,01 rechazado por el servidor: «El descuento no puede pasar del 50 % (Bs 85,00)»**. |
| **GST-004 cobro** | Descuento 10 (motivo), propina 5, efectivo recibido 170: subtotal 170,00; total 160,00; a cobrar 165,00; **vuelto 5,00** (recálculo propio: 170−10=160; 160+5=165; 170−165=5). |
| GST-005 | Un toque agrega el plato; **+** lo sube a 2× (156,00 = 2×78); − y Quitar presentes. Dos toques rápidos seguidos cuentan solo uno (anti-doble toque). |
| GST-007 | Aviso verde «Caja abierta. Ya puedes cobrar.» |
| GST-003 | Cerrar caja y Revocar código usan modal propio. |
| Cierre de caja | Esperado 265,00 = 100,00 + 160,00 + propina en efectivo 5,00 (el vuelto no cuenta). Contado 265 → «La caja cuadra». |
| Contabilidad | Ingresos 852,00 = 692+160 (la propina NO es ingreso). IT 3 % × 852,00 = 25,56 (rotulado referencial). Asiento N° 187: Caja 165,00 = Propinas por entregar 5,00 (2.1.05) + Ventas 160,00. Balance «Cuadra: Activo = Pasivo + Patrimonio». |
| Inventario valorado | Suma de las 19 filas = 4.950,38 = tarjeta «Valor del inventario». |
| Estadísticas / FODA | Costo de alimentos 8.627,36/34.998,00 = 24,65 %; ticket 34.998/397 = 88,16; FODA «+25,18 %» = (59.682−47.678)/47.678. Margen Pique macho 76,51 %. OK. |
| Cuentas por cobrar | 1.947,75 = 1.988,00 − 30,25 − 10,00 (cobros hechos por QA). |
| Suscripción | 12 meses × 689,04 = 8.268,48 (OK). |
| Públicas | Menú público 200; slug inexistente 404; `/m/token-invalido` → «Este QR no está disponible. Pide ayuda a tu mesero.»; `/r/casa-andina-58abb4` carga; legales 2026-11-14.1. |

## Hallazgos nuevos
| ID | Sev. | Descripción | Estado |
| --- | --- | --- | --- |
| **GST-011** | **Media** | El recibo impreso NO mostraba descuento, propina, efectivo recibido ni vuelto (la sección C2 decía que sí): con descuento los renglones sumaban 170 y el total decía 160 sin explicación. | **Corregido** (`dc66531`) y **verificado en vivo** (`GST-011-recibo-con-descuento-propina-vuelto-despues.jpg`): 170,00 / −10,00 / 160,00 / 5,00 / 165,00 / 170,00 / 5,00. |
| **GST-012** | Media | Invitación de personal: el código es de un solo uso, vence a 7 días, solo se guarda su huella y «Nuevo código» regenera, pero la tarjeta no decía si había código vigente o vencido y no se podía revocar sin desactivar a la persona. | **Corregido** (`1549016`): «Código de un solo uso vigente hasta el DD/MM», «vencido» o «sin código vigente», y botón **Revocar código** (modal + auditoría `personal.codigo_revocado`, `DELETE /personal/:id/codigo`). **Verificado en vivo** con «QA Invitado Mesero». |
| GST-013 | Baja | Con el descuento sobre el tope, el resumen del cobro muestra «− Bs 85,01» pero el total sigue en 170,00 y el rechazo solo llega al confirmar; el aviso rojo se queda aunque se corrija el monto. | Propuesta. |
| GST-014 | Baja | «Costo prom.» del inventario se muestra con 2 decimales y el valor usa más: 11 de 19 filas no cuadran al centavo a mano (Huevo 144 × 1,12 = 161,28 frente a 161,61). El total sí cuadra. | Propuesta (mostrar 4 decimales). |
| GST-015 | Baja (demo) | Alertas de «Caída de ventas» cada día (ayer Bs 0,00) porque la demo termina el 31/10; «Ventas por hora» muestra una sola barra. | Propuesta (renovar el sembrado). |
| GST-016 | Baja (demo) | Suscripción: «Habilitada hasta 2036-10-27» pero el pago aprobado dice «habilita hasta 2027-10-12». | Propuesta. |
| GST-017 | Baja | Tras crear una persona el rol queda marcado; un 502 durante el despliegue solo dice «No pudimos completar la acción.» | Propuesta. |
| GST-018 | Baja | Cada pantalla tarda 5 a 8 s en salir de «Cargando…» con varios ejecutores activos. | Observación. |

## No verificado en pantalla en esta pasada (causa)
- Reaceptación legal: `prueba_kyros` es cuenta demo exenta; solo por código y por la versión servida 2026-11-14.1. Pendiente con `qa_gestro_*`.
- Cierre por inactividad (25/30 min): no se esperó; solo por código.
- «Nada se borra»: no se borró nada (orden del dueño); solo código y pruebas.
- Responsive: la ventana automatizada no cambió de ancho (innerWidth 1920). Inglés, tema, teclado, cocina, salón con QR de mesa real, eventos, plan del día, turnos, promociones, edición de recetas y merma: no recorridos a fondo.
- Cambio de plan con prorrateo: requiere `qa_superadmin`.
- Consola/red: un 502 durante el relevo de contenedor; sin otros errores.

## Recorrido para socios y residuos
Ver `QA-CUENTAS-CREADAS.md` → «GESTRO — recorrido para socios». Residuos para mostrar: tope de descuento 50 %; caja cerrada y cuadrada; pedido «QA Socio Dueño»; persona «QA Invitado Mesero». Interruptores demo: ninguno.

## Nota NODE_ENV (revisión transversal, 14/11/2026)
Revisados Dockerfile, docker-compose y configuración de build. **Sin hallazgo.** `NODE_ENV=development` aparece solo dentro de `RUN ... install` (para instalar las devDependencies) y no pasa a la capa del build ni a la imagen final; el runtime fija `NODE_ENV=production`; `sourcemap: false`. Verificación en vivo con `curl` del JS principal: `https://gestro.kyros-tech.com` JS principal 346.605 bytes (gzip 129.757), 0 marcadores de desarrollo. No se cambió nada.



## Nota: Tipo de cambio (auditoria transversal 14/11/2026)

Hecho: desde el 29/06/2026 el BCB abandono el Bs 6,96 fijo; el TCO se publica a diario (14/11/2026: Bs 11,67; GET https://www.kyros-tech.com/api/v1/tipo-cambio).

- Hallazgo CRITICO (calculo de dinero): la migracion 0020 sembro plans.monthly_price_bob a 6,96 (Esencial 174,00 / Profesional 341,04 / Cadena 689,04) y el cobro de suscripcion (calculo, crearPago, monto esperado, prorrateo de cambio de plan) usaba ese Bs, aunque los planes valen USD 20/35/60 (migracion 0021). Con TCO 11,67 lo correcto es Bs 233,40 / 408,45 / 700,20.
- Cambio (commit 7961225, main): Bs = USD x TCO del dia con BigInt (mitad hacia arriba), precio-bs.ts; sin TCO vigente -> 503 TIPO_CAMBIO_NO_DISPONIBLE (nunca se inventa); un plan sin USD conserva su Bs manual; el pago guarda TCO, fecha y fuente (migracion aditiva 0029 + reversa). mia, calculo, planes (plataforma) y prorrateo de cambio de plan usan el mismo calculo.
- Pruebas: test/precio-bs.puro.spec.ts (14 casos, recalculo independiente BigInt: 20/35/60 USD a 11,67 = 233,40/408,45/700,20; 15 x 11,675 = 175,13). tsc limpio. NO ejecutadas las pruebas de integracion con base (no hay Postgres local). Los datos de prueba QA no se tocaron.
- Verificacion en vivo: el sitio responde 200 tras el despliegue; el calculo requiere sesion y no se probo en vivo (pendiente).

---
# FASE C: restaurante NUEVO «QA Restaurante Andino» con `qa_gestro_dueno_1` (15/11/2026, hora de Bolivia)

Registro real (no demo), ingreso por impersonación. Todo con datos propios. Sin tocar contraseñas; no se cerró sesión de Kyros ID; nada se borró.

## Registro (`/registro`), verificado en pantalla
| Prueba | Resultado |
| --- | --- |
| Botón con casilla legal sin marcar / campos vacíos | «Abrir mi restaurante» deshabilitado, sin mensaje que diga por qué (GS-N03, bajo). |
| Popups «Leer» (Términos, Privacidad) | Abren con ES/EN, versión 2026-11-14.1, titular Kyros-Tech S.R.L., 18 años; cuenta nueva: el registro cubre la aceptación. OK. |
| Tildes/ñ («QA Dueño Peña Ñandú») | Guardado y mostrado bien en cabecera. |
| **NIT con letras («ABC12345»)** | **Aceptado sin aviso** (GS-N04, media). |
| Sin `maxLength` en ningún campo | No probado con textos de miles de caracteres; el límite depende del servidor (no verificado). |
| Resultado | Dueño «QA Dueño Peña Ñandú», restaurante «QA Restaurante Andino», panel abierto; «Habilitada hasta 2026-11-30». |

## Hallazgos nuevos (FASE C)
| ID | Sev. | Descripción | Estado |
| --- | --- | --- | --- |
| GS-N01 | Baja/Media | **Días de prueba inconsistentes**: Panel decía «Faltan 16 días» y Suscripción «Faltan 15 días» para el mismo 2026-11-30. Causa: `Panel.tsx` calculaba `Math.ceil` contra el mediodía de La Paz (cambia con la hora). La fecha final es correcta: 15/11 + 15 días = 30/11, en hora de La Paz (la API usa `HOY` de La Paz). | **Corregido** `dc67c03` (fecha de calendario UTC-4); verificado en vivo tras el despliegue: Panel «Faltan 15 días» = Suscripción; Panel: ticket 500/3 = 166,67 y margen 67,8 % = (500−160,88)/500 OK |
| GS-N02 | Media (no verificado) | **IVA incluido = importe×13/113** (compra con factura Bs 820,00 → crédito fiscal Bs 94,34). SIN (nota de prensa 19/02/2026, impuestos.gob.bo): hoy el IVA «está incorporado dentro del precio final» con tasa efectiva ≈14,94 % (13/87), es decir IVA = 13 % del precio facturado (factura de Bs 200 → Bs 26 según guía de restaurantes); el 13 % «efectivo real» sobre base neta es el proyecto de ley (Ley 1733, vigencia pendiente de reglamento: NO verificado). Con la regla vigente el crédito de Bs 820 sería **106,60**, no 94,34. No se cambió el código (pruebas y el régimen IVA Transparente del piloto dependen de esa decisión): **decisión del dueño/contador**. Solo afecta compras «con factura» (las ventas salen con Recibo). | Propuesta |
| GS-N03 | Baja | Registro: botón deshabilitado sin explicación. | Propuesta |
| GS-N04 | Media | El NIT acepta letras y cualquier largo. | Propuesta (validar formato) |
| GS-N05 | Media | **La sesión de GESTRO sobrevive al cierre de Kyros ID** (hallazgo del coordinador): GESTRO guarda su propia sesión y no hay cierre por canal trasero (back-channel logout); es diseño, no solo un token vigente (8 h). No reproducido a propósito (no se cerró Kyros ID). «Cerrar sesión» sí cierra ambas. | Propuesta |
| GS-N06 | Baja | «Agregar mesa» pulsado sin esperar la respuesta anterior pierde datos (el formulario se reinicia y el área vuelve a «Sin área»). | Observación |
| GS-N07 | Media | **No se pueden editar los roles de una persona** (solo Desactivar / Nuevo código); el rol «Mesero» preseleccionado quedaba marcado tras crear (GST-017) y se crearon cuentas con roles de más. | GST-017 corregido `dc67c03`; edición de roles: propuesta |
| GS-N08 | Media | **No hay «dividir cuenta»** (ni por ítems ni por personas) en el cobro. | Propuesta |
| GS-N09 | Baja | El comentario del cliente por QR («Sin picante…») no se ve en la ficha del pedido del mesero (no se comprobó en Cocina). Tarjeta «4 platos» para 7 unidades y total 0,00 hasta confirmar. | Observación |
| GS-N10 | Baja | «Entrada» de insumos genera «Compra al contado» que acredita Caja aunque no haya efectivo: el libro mostró caja negativa (321 − 662). | Propuesta (pedir forma de pago) |
| GS-N11 | Baja | Margen de Recetas = (precio − costo)/precio con precio final; no descuenta IT 3 % ni IVA (informativo). | Propuesta |

## Datos del restaurante
Sucursal «QA Restaurante Andino». Salón: áreas Salón principal y Terraza; mesas 1 y 2 (Salón), 3 (sin área, a propósito), T1 (Terraza). Menú (Bs): Pique macho 78, Silpancho 45, Fricasé 52, Sopa de maní 28, Salteña 12, Api con pastel 15, Jugo de tumbo 14, Mocochinchi 10 (3 categorías, alérgenos). Almacenes Cocina y Bodega seca; 9 insumos con entradas (Papa 20 kg a 4,50; Arroz 15 a 9,00; Maní 3 a 38,00; Huevo 60 a 1,20; Harina 8 a 7,00; Tumbo 5 a 12,00; Durazno 3 a 45,00). Proveedores: Carnes Don Beto S.R.L. (NIT 1023456028, crédito 15 d) y Verduras Mercado Los Pozos (contado). Compra a Don Beto: res 10 kg a 62,50 + cerdo 6 kg a 48,75 = 917,50; recibida parcial (res 10, cerdo 4), factura F-1001 con IVA = 820,00; pagado 320,00 por banco; saldo por pagar 500,00 (vence 30/11). 8 recetas.

## Verificación de cálculos (recálculo independiente, centavo a centavo)
| Cálculo | Esperado | Pantalla | Res. |
| --- | --- | --- | --- |
| Orden de compra | 10×62,50 + 6×48,75 = 917,50 | 917,50 | OK |
| Recepción parcial | 10×62,50 + 4×48,75 = 820,00 | 820,00 | OK |
| Vencimiento CxP | 15/11 + 15 d = 30/11/2026 | 30/11 | OK |
| Pago mayor al saldo | rechazo | «El pago supera el saldo (Bs 820.00)» | OK |
| Pago 320 | saldo 500,00 | 500,00 | OK |
| Valor de inventario | 820 + 90+135+114+72+56+60+135 = 1.482,00 | 1.482,00 | OK |
| Costos de receta (HALF_UP) | Pique 18,175→18,18; Sopa 2,575→2,58; Salteña 4,285→4,29; Silpancho 16,385→16,39; Fricasé 15,525→15,53; Api 1,02; Jugo 3,00; Moco 2,70 | idénticos | OK |
| Márgenes | 76,70; 90,80; 64,29; 63,59; 70,14; 93,20; 78,57; 73,00 % | idénticos | OK |
| Pedido QR mesa 1 | 2×78+45+2×14+2×12 = 253,00 | 253,00 | OK |
| Cobro efectivo: desc 3, propina 10 %, recibido 300 | total 250,00; propina 25,00; a cobrar 275,00; vuelto 25,00 | idénticos | OK |
| Anulación de línea (2× Mocochinchi) | 124 − 20 = 104,00; sin motivo no cierra | 104,00 | OK |
| Crédito mesa 3 | 2×45+2×28 = 146,00; plazo 20 d → 05/12/2026 | idénticos | OK |
| Cobro parcial de cuenta 46,00 | saldo 100,00 | 100,00 | OK |
| Arqueo | 150,50 + 250,00 + propina 25,00 + 46,00 = 471,50; contado 470,50 → −1,00 | idénticos | OK |
| Ingresos / IT 3 % | 250+104+146 = 500,00 (propina fuera); IT 15,00 | 500,00 / 15,00 | OK |
| Costo de ventas por pedido | 67,305→67,31; 36,45 (incluye 5,40 de lo anulado ya enviado); 37,92; 19,195→19,20 | idénticos; total 160,88 | OK |
| Balance | Activo 864,12 = Pasivo 525,00 + Patrimonio 339,12 | cuadra | OK |
IVA incluido 13/113: ver GS-N02 (no verificado como correcto).

## No hecho en esta pasada
Cambio de plan con prorrateo (planes apagados, «Sin plan»; necesita `qa_superadmin`); cocina `/cocina` y sesiones de mesero/caja (el coordinador las abre con los códigos de `QA-CUENTAS-CREADAS.md`); responsive/inglés; textos de miles de caracteres; reservas, eventos, turnos.

## Recorrido para socios: «QA Restaurante Andino»
Entrar con `qa_gestro_dueno_1` (dueño). Mirar: Panel (suscripción hasta 30/11, «Faltan 15 días» en Panel y Suscripción); Salón (4 mesas; pedido abierto en T1 en cocina, Bs 93,00); Menú y Recetas (costo y margen de 8 platos); Inventario (valor 1.482); Compras → Por pagar (Bs 500,00 a Don Beto); Cuentas por cobrar (QA Cliente Crédito Mamani, saldo 100,00); Caja (cerrada, faltante −1,00); Contabilidad (ingresos 500, IT 15, balance cuadra); Personal (invitaciones).

## Facturación Flujo 1 y panel SuperAdmin (15/11/2026, rama `qa/gestro-facturacion-flujo1-2026-11-15`, en main `cef6cdd`)
Kyros-Tech factura a sus clientes (restaurantes) la suscripción a través de FacturaSIN. **Todo simulado**: empresa «Kyros-Tech S.R.L. (SIMULADO)», NIT ficticio 1000000001 (`gestro:kyros-tech`); no se inventó ningún NIT real. Guía completa y cómo replicarlo en otros sistemas: `docs/facturacion-kyros.md` del repositorio.
- **Qué se construyó:** núcleo reutilizable sin dependencias (`apps/api/src/facturacion-kyros/nucleo/`: cálculo en centavos, validación fiscal, CSV seguro, orquestación idempotente `emitirFactura`, copia del SDK de FacturaSIN con `qr()`); servicio y rutas; migración aditiva y reversible `0030` (`accounts.fiscal_doc_type/complement/email`, `kyros_invoices` con RLS forzada, `kyros_invoice_events`); gancho en `SuscripcionService.aprobar` (después de activar, sin bloquear ni fallar); webhook público `POST /api/v1/webhooks/facturasin` (HMAC sobre cuerpo crudo, anti-replay 5 min, 2 secretos en rotación, deduplicación por Event-Id, sin retroceso de estado); ciclo cada 5 min (concilia, reintenta con espera 2^n min, emite lo nunca intentado); pestaña «Facturación de Kyros» en `/plataforma`; «Datos para tu factura» y «Mis facturas» en Suscripción; validación del NIT en el registro (5-13 dígitos, sin ceros a la izquierda).
- **Reglas aplicadas:** sin pago validado no hay factura; sin factura hay alerta (1 h) y alerta crítica (24 h), nunca bloqueo; se factura lo cobrado; IVA 13 % por dentro en centavos (116,70 → 15,17); TCO del día del pago (11,67); Ley 1733 no activada (la integración nunca llama a `iva-transparente` ni `siat-mode`); sin NIT queda pendiente y solo una persona puede emitir «consumidor final» (CI 0, «S/N»; NO verificado con el SIN).
- **Seguridad:** integración APAGADA por defecto; secreto de `gestro-service` solo por el catálogo de integraciones (cifrado, solo escritura); URL de FacturaSIN solo https (http solo en local fuera de producción); configuración y secreto del webhook exigen confirmar identidad (15 min); panel solo `SoloPlataforma` (dueño de restaurante = 403, sin sesión = 401; verificado en 11 rutas); PDF/XML/QR pasan por GESTRO; el cliente solo ve y descarga las suyas (RLS + 404 en las ajenas); cada acción se audita (`facturacion_kyros.*`).
- **Pruebas automáticas (todas en verde):** `test/facturacion-kyros.puro.spec.ts` 40 pruebas de cálculo contra oráculo independiente `decimal.js` (16 importes límite, 1 000 pseudoaleatorios, TCO con 3 decimales, 6,96 ≠ 11,67, promoción 10 %, prorrateo 20→35 USD, renovar suma, firma del webhook con el vector oficial de FacturaSIN, CSV `= + - @ tab \r`) y `test/facturacion-kyros.spec.ts` 18 pruebas del flujo completo contra `test/facturasin-doble.ts` (doble fiel del contrato Fase 1): pago validado→factura (Bs 116,70 / IVA 15,17 / clave = id de pago / extras con USD y TCO); pago no validado 409; reintento idempotente tras respuesta perdida (misma factura, mismo CUF); FacturaSIN caído (503) → suscripción activa + alerta + el ciclo la emite al volver; rechazo del SIN → reintento con clave `:r2`; estado «pendiente» del SIN → conciliación; sin NIT → alerta, consumidor final solo a pedido y marcado; anulación con motivo (400 sin comentario, 409 repetida, auditoría); PDF/XML/QR; totales exactos (tres pagos: cobrado 758,55, facturado 525,15, IVA 68,27 = 15,17 + 53,10, por facturar 233,40) con control SQL; filtros y escape de `%`; CSV sin fórmulas; webhook (firma inválida/vieja/alterada → 401, duplicado, desordenado, anulada manda, factura ajena); permisos del panel; integración apagada no emite; validación de datos fiscales. Suite completa de la API: 311 pruebas verdes + 1 omitida; `tsc` de API y web limpios; web 19 pruebas.
- **No verificado / límites:** no se probó contra FacturaSIN real ni desplegado (el doble sigue el contrato documentado); consumidor final y método de pago 7 sin confirmar con el contador/SIN (Q4); sin notas de crédito (F6: solo anular); factura siempre «con crédito fiscal» (F10); `hub-service` aún falta en Kyros ID (F12); la política de privacidad/términos de GESTRO dicen «no emite facturas» (§4): sigue verdadero para el restaurante (Flujo 2) pero habrá que mencionar que Kyros-Tech factura la suscripción y trata NIT/razón social, con versión legal nueva, cuando se active en producción.
- **Qué debe verificar el coordinador en vivo:** (1) el dueño pega el secreto de `gestro-service` en Plataforma › Integraciones (`KYROS_SERVICE_CLIENT_SECRET`) y en Coolify de FacturaSIN `SEMBRAR_SIMULADAS=1` (o `POST /api/v1/admin/seed-simulated`) para crear `gestro:kyros-tech`; (2) en la pestaña «Facturación de Kyros»: «Activar», «Suscribir webhook» (URL pública https de GESTRO) y «Conciliar ahora»; (3) con `qa_gestro_dueno_1`: Suscripción › Datos para tu factura (NIT 1020304050 de prueba), declarar un pago con voucher; con `qa_superadmin`: aprobar y ver la factura Emitida + Simulada, abrir PDF/XML/QR (el PDF debe llevar «Ambiente de pruebas / sin validez fiscal»), anular con motivo, exportar CSV; (4) apagar FacturaSIN (o usar un secreto errado) y comprobar que el pago se aprueba igual y aparece la alerta; (5) el despliegue aplica la migración 0030 sola.
- **Recorrido para socios:** tras activar, los pagos ya validados de «QA Restaurante Andino» aparecen como «Pendiente de emitir»: el botón «Emitir factura» las convierte en facturas simuladas visibles con PDF.

## Facturación Flujo 2: el restaurante factura a sus comensales vía FacturaSIN (15/11/2026, rama `qa/gestro-facturacion-flujo2-2026-11-15`)

Alcance: todo en **ambiente de pruebas / sin validez fiscal** (decisión del dueño: «lo que hay que probar es el flujo»). Código nuevo en `apps/api/src/facturacion-emisor/` (módulo propio; no toca SuperAdmin ni suscripciones del Flujo 1). Migración **0031** (aditiva y reversible: `billing_settings`, `fiscal_invoices`, `fiscal_webhook_events`, `menu_items.sin_unit_code`; RLS forzada; sin DELETE para `app_user`).

**Qué hace**
1. **Configuración** (Configuración → «Facturación electrónica a tus clientes», solo dueño/administrador): NIT, razón social, actividades económicas SIN, sucursal y punto de venta, municipio, dirección, leyenda, modalidad (solo «simulado»: `real` se rechaza con 422 hasta que el SIN autorice), código y unidad SIN por defecto, permitir «sin nombre», token delegado del emisor, «Probar conexión» (solo lectura: credencial, Kyros ID, emisor, enlace, sucursal y punto de venta) y «Conectar con FacturaSIN» (crea o enlaza la empresa `gestro:<id>`, envía la credencial si FacturaSIN lo permite, suscribe el webhook). El aviso «Ambiente de pruebas / sin validez fiscal» está siempre visible. Validaciones en pantalla y servidor: NIT de 5 a 13 dígitos, vacíos, símbolos (`<>`), tildes y ñ conservadas (NFC). Un NIT no lo puede reclamar otra cuenta (409). La pantalla está solo en español, como el resto de la web de GESTRO (no existe infraestructura i18n; los textos legales sí son es/en).
2. **Facturar**: en «Cobrar» aparece «Factura electrónica (pruebas)» (si está configurada) y, en un pedido ya cobrado con recibo o solo contabilizado, el panel «Factura» con «Facturar este pedido». Datos del comensal: NIT / CI (+complemento) / pasaporte / carnet de extranjero / otro, razón social, correo, excepción de NIT, o «sin nombre» (CI 0, S/N) si el dueño lo permite; con tarjeta pide los 4+4 dígitos. Se valida **antes** de cobrar. Ítems con el código SIN del plato (campos nuevos «Código SIN» y «Unidad SIN» en Menú) o el de la configuración; unidad 57 por defecto; el descuento del pedido va como `descuentoAdicional`; **la propina nunca se factura**; moneda Bs; IVA 13 % «por dentro». Clave de idempotencia = `gestro:<pedido>:<intento>` (también `idExterno`); un intento nuevo solo tras rechazo o anulación. Se guardan estado, número, CUF, fecha, enlaces, QR y aviso. Ver/imprimir PDF (lo pide el servidor a FacturaSIN; XML solo dueño), «Reintentar ahora», «Anular factura» con motivo SIN y explicación (solo dueño/administrador) y lista en `/app/facturas` con conciliación. Se quitó el rechazo de `documento:'factura'`.
3. **Estados y webhook**: `POST /api/v1/public/facturasin/webhook/<restauranteId>` verifica HMAC-SHA256 (`X-FacturaSIN-Signature`, sobre el cuerpo crudo, tolerancia de 5 min, dos firmas en rotación), deduplica por `X-FacturaSIN-Event-Id`, ignora eventos anteriores al último aplicado y de facturas desconocidas, y actualiza pendiente/validada/observada/rechazada/anulada/contingencia. Conciliación cada minuto de «pendiente/contingencia» y cola de reintentos (30 s, 1, 2, 4… máx. 15 min) para «en cola». **La venta nunca se bloquea**: sin FacturaSIN el cobro se registra, la factura queda «Pendiente de emitir» (visible en el pedido y en Facturas), se alerta al dueño (tipo `facturacion`) y se reintenta con la MISMA clave. Un cobro con factura vigente no se puede anular antes que la factura.
4. **Secretos**: el token delegado y los secretos de webhook se guardan cifrados (AES-256-GCM) en `app_config`; nunca en variables de entorno, logs, auditoría ni respuestas (probado). El secreto del client `gestro-service` se carga en la consola de plataforma (clave `KYROS_SERVICE_CLIENT_SECRET`, ya existente). Las direcciones públicas (`FACTURASIN_URL`, `KYROS_ID_EMISOR_SERVICIO`) se leen en `config/entorno.ts` solo como literales no secretos, con los valores de producción por defecto.
5. **Legal**: versión **2026-11-15.1** (reaceptación por el patrón del sistema: `VERSION_LEGAL` + textos es/en sincronizados). Términos §2, Políticas §4 y Privacidad §1 y §4 reescritos con precisión («emite facturas a través de FacturaSIN en ambiente de pruebas, sin validez fiscal»; tratamiento de NIT/CI/pasaporte, razón social y correo del comensal; FacturaSIN como encargado; sin afirmar autorización del SIN ni ubicación de servidores).

**Matriz de verificación de cálculos (recálculo independiente en centavos: `factura-calculo.puro.spec.ts` y `facturacion.spec.ts`)**

| Cálculo | Fórmula | Fuente | Casos | Resultado |
|---|---|---|---|---|
| Importe de línea | cantidad × precio, un solo redondeo, mitad hacia arriba | igual a `subtotalLineaCentavos` de FacturaSIN | 0,5×15,55=7,78; 0,333×10=3,33; 1,5×0,01=0,02; enteros | OK |
| Total facturado | Σ líneas − descuento; la propina queda fuera | Ley 843 (la propina no es venta) y decisión de diseño | 163,00 − 13,00 = 150,00 (propina 10,00 aparte); 5000 casos aleatorios con aritmética Number/Math independiente | OK, 0 diferencias |
| IVA «por dentro» | 13 % × importe facturado, mitad hacia arriba | Ley 843 arts. 4, 5 y 15 según FS-002 de FacturaSIN (fuente secundaria; **no verificado** en Gaceta) | 150,00→19,50; 116,70→15,17; 0,01→0,00; 0,04→0,01; 0,05→0,01; 163,00→21,19 | OK; además se contrasta con lo que devuelve FacturaSIN en cada factura (si difiere: alerta y nota) |
| Total factura = cobro | total calculado debe igualar `sales_payments.amount` | consistencia interna | caso con descuento | OK; si no cuadra no se emite y se alerta |
| Método de pago SIN | efectivo 1, tarjeta 2, QR/transferencia/crédito 7 | catálogo del simulador (solo 1, 2 y 7) | — | **A confirmar con el contador** (pregunta Q4) |

**Hallazgos y notas**
- GS-F2-01 (Media, corregido): `sales_payments.document='factura'` se rechazaba siempre; ahora el cobro funciona y el asiento contable se registra **sin separar IVA** (como «sin documento») porque el criterio de GESTRO (IVA = importe×13/113, GS-N02) difiere del de FacturaSIN (13 % del importe). Hasta que el dueño/contador decida GS-N02, el libro de ventas sigue en cero; la factura de pruebas es un documento paralelo.
- GS-F2-02 (Baja, corregido): el orden de ítems de una factura era no determinista cuando se enviaban a la vez; ahora es por tiempo, plato e id.
- Limitación: FacturaSIN no deja que un sistema cree sucursales ni puntos de venta distintos de 0; «Probar conexión» lo avisa.
- Una factura rechazada o con datos inválidos no se reintenta sola: se corrige y se vuelve a facturar (intento nuevo, otra clave).

**Pruebas**: `factura-calculo.puro.spec.ts` (10) y `facturacion.spec.ts` (15, contra un doble fiel de FacturaSIN, `test/facturasin-doble-emisor.ts`): emisión válida, idempotencia, caída con reintento sin bloquear la venta, falta de credencial, rechazo del SIN, NIT inválido con excepción, anulación, cancelación antes de emitir, conciliación, webhook firmado/inválido/vencido/duplicado/viejo/ajeno, secretos nunca expuestos y aislamiento por sucursal.

**Recorrido para socios** (no se borró ningún dato): entrar a GESTRO con una cuenta de dueño → Configuración → «Facturación electrónica a tus clientes» (NIT de prueba `1000000005`, «Restaurante Demo (SIMULADO)» de FacturaSIN) → Menú (campos «Código SIN») → Caja: abrir caja, tomar un pedido, «Cobrar» → «Factura electrónica (pruebas)» → ver el PDF con el aviso de pruebas → `/app/facturas` → anular con motivo.

**Qué debe verificar el coordinador en vivo (depende del dueño)**
1. Que el secreto del client `gestro-service` esté cargado en GESTRO (consola de plataforma → Integraciones → `KYROS_SERVICE_CLIENT_SECRET`) y que ese client exista en Kyros ID con audiencia `facturasin-api`. Sin eso las facturas quedan «Pendiente de emitir» con la causa visible.
2. Que FacturaSIN en producción tenga `SEMBRAR_SIMULADAS=1` (empresas simuladas, `gestro:demo-restaurante` ↔ NIT 1000000005) y `gestro-service` registrado (`/api/v1/admin/systems`).
3. En pantalla: «Probar conexión» → «Conectar con FacturaSIN» (el webhook exige `URL_PUBLICA` https del compose: `https://gestro.kyros-tech.com`); cobrar con factura; PDF; anular; apagar y encender FacturaSIN para ver «Pendiente de emitir» y su reintento; revisar el aviso «sin validez fiscal» en pantalla y en el PDF.
4. Aceptación de la versión legal 2026-11-15.1 al ingresar con una cuenta no exenta.
