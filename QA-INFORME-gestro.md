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
