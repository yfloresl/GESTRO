# GESTRO

Sistema de Gestión de Restaurantes (SaaS multi-sucursal) de Kyros-Tech. Estándar Sistemas-Kyros, ingreso con Kyros ID y presencia en el Portal Kyros.

## Estado: F4 en curso (reservas, eventos y turnos hechos) sobre F3, F2, F1 y F0

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

**F1b (hecho):** toma de pedidos del personal (mesa, mostrador, llevar y delivery) con tickets diarios correlativos, notas y modificadores, anulación de platos con permiso y motivo, mover de mesa; pedido del cliente por QR (con confirmación del mesero o directo a cocina, configurable); tablero de cocina (KDS) en modo oscuro con cronómetro y alerta de demora, aviso al mesero cuando el pedido queda listo; caja con apertura y arqueo, cobro con recibo correlativo (no fiscal) o solo contabilizar, anulación de ventas con motivo.

**Pendiente de F1b por decisión de alcance:** dividir cuenta y juntar cuentas, promociones y descuentos, descuento de insumos al enviar (llega con recetas e inventario, F2), PIN de supervisor para anular y asientos contables (F3).

**F1c (hecho):** suscripción por sucursal con pago por QR bancario y **validación manual** del comprobante (la IA no interviene), meses de regalo y descuento por promoción, avisos a 5 días, 1 día y el día del vencimiento, gracia y modo solo lectura (402) sin perder datos; consola de plataforma para Kyros-Tech (pagos, sucursales, planes, promociones, QR e instrucciones de cobro); **tarjeta en el Portal Kyros** con `portal/summary` y `portal/account` (token del client `portal-web`, audiencia `gestro-portal`, CORS solo para el Portal, sin datos personales).

**F2 (hecho):** inventario por movimientos (kardex de solo-añadir, stock que la app no puede editar a mano, costo promedio ponderado, FEFO por lote, traspasos, conteo físico, alertas); recetas con versiones y sub-recetas, costo y margen contra el mínimo de la sucursal; plan del día con insumos contra el stock de cada almacén; compras (proveedores, órdenes, recepción parcial con diferencias, historial y alza de precios, cuentas por pagar); el descuento de insumos ocurre al **enviar a cocina** y nunca frena una venta.

**F3 (hecho):** contabilidad de nivel medio con partida doble. Plan de cuentas de restaurante (plantilla editable) y centros de costo; asientos automáticos de venta cobrada, costo de ventas (al costo promedio, al enviar a cocina), compra recibida (con o sin IVA incluido), pago a proveedor, compra al contado, merma y ajuste/conteo de inventario; asientos manuales en borrador que se publican con correlativo sin huecos; un asiento publicado **no se edita ni se borra** (lo impide la base) y se corrige contrarrestándolo; anular una venta genera su contra-asiento; períodos que se cierran (el dueño reabre) — los asientos automáticos nunca frenan una venta y, si el mes está cerrado, caen en el primer mes abierto. Reportes: sumas y saldos, estado de resultados, balance general, libro mayor, flujo de caja, libros de IVA e impuestos referenciales (IVA 13 % e IT 3 % son parámetros de la sucursal que valida el contador). Las ventas a crédito (nombre del cliente, teléfono y plazo) nacen como cuenta por cobrar; la pantalla **Cuentas por cobrar** registra cobros totales o parciales por caja o banco, cada uno con su asiento, y anular una venta a crédito sin cobros retira la deuda. El correlativo de asientos no tiene huecos: los borradores llevan un número provisional y el definitivo se asigna al publicar.

**F4a (hecho): reservas.** Web pública `/r/<slug>` sin cuenta (fecha, personas, horas libres, código para cancelar) y agenda del personal (confirmar, sentar, terminó, no llegó, cancelar, cambiar de mesa, crear a mano). La mesa se asigna sola (la más chica que alcance) y la base impide con una restricción de exclusión que una mesa tenga dos reservas activas cruzadas: si dos clientes piden la última mesa a la vez, uno gana y el otro recibe 409. Cada sucursal decide si las recibe, horario, duración, máximo de personas y si se confirman solas; avisa al personal en tiempo real y por Web Push.

**F4b (hecho): eventos y catering.** Cotización con el costo real de las recetas (venta a precio de carta, costo, utilidad, margen y precio por invitado), menú con porciones, insumos necesarios contra el stock y órdenes de compra en borrador con lo que falta. Los anticipos son dinero del cliente (pasivo «Anticipos de clientes») hasta que el evento se realiza; al **iniciar** salen del inventario los insumos del menú (una sola vez, con su costo de ventas); al **cerrar** se reconoce el ingreso y lo no cobrado queda como cuenta por cobrar. Cancelar con cobros exige devolverlos (cobro anulado y asiento contrarrestado).

**F4c (hecho): personal, turnos y asistencia.** Funciones del personal, datos laborales (función, costo por hora, sueldo — solo los ven dueño, administración y contador) y personas eventuales sin usuario. Turnos por semana con turnos nocturnos que cruzan la medianoche; la base impide que una persona tenga dos turnos cruzados. Cada persona ve «Mis turnos» y marca su entrada (desde una hora antes) y su salida, que calcula el pago por horas trabajadas. Turnos ligados a un evento suman su costo de personal a la cotización del evento. Reporte de costo por persona y por evento. La nómina contable no se genera: el costo queda como reporte.

Siguiente: **F4d promociones**, luego F5. Ver `docs/ROADMAP.md`.

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
