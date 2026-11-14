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
