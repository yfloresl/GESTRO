# Facturación de Kyros-Tech a sus clientes (Flujo 1) con FacturaSIN

Piloto en GESTRO (15/11/2026). **Todo corre contra FacturaSIN en SIMULACIÓN: ninguna factura tiene validez fiscal** y Kyros-Tech S.R.L. usa el NIT ficticio `1000000001` («Kyros-Tech S.R.L. (SIMULADO)», empresa externa `gestro:kyros-tech`). No se inventó ningún NIT real.

## Reglas de negocio (decididas por el dueño)
- Sin pago validado no hay factura ni activación. **Sin factura emitida hay alerta, no bloqueo**: la activación no depende del SIN ni de FacturaSIN.
- Precio del plan en USD × TCO del día de la validación del pago (`https://www.kyros-tech.com/api/v1/tipo-cambio`; hoy 11,67, nunca 6,96). GESTRO ya guarda el TCO en cada pago (`fx_usd_bob`, migración 0029).
- Se factura **lo cobrado** (monto del pago validado, ya con promociones/prorrateos). Renovar suma días y los cambios de plan prorratean (lógica existente `suscripcion/periodos.ts`, no se tocó): el cambio de plan no genera cobro y por tanto no genera factura; la diferencia que se pague después se factura tal cual.
- IVA 13 % «por dentro» (Ley 843 art. 5), en enteros de centavos, mitad hacia arriba: Bs 116,70 → IVA 15,17. Ley 1733 (IVA Transparente) NO se activa; la integración nunca llama a `iva-transparente` ni a `siat-mode`.
- Sin NIT del cliente: la factura queda **pendiente con alerta**. Solo una persona del panel puede pulsar «Emitir como consumidor final» (CI `0`, razón social `S/N`), que queda marcado en la factura. Ese caso NO está verificado con el SIN (FacturaSIN no lo documenta): si lo rechaza, queda pendiente con el motivo.

## Qué hay
| Pieza | Dónde |
|---|---|
| Núcleo reutilizable (sin Nest ni base de datos) | `apps/api/src/facturacion-kyros/nucleo/` |
| Servicio + SQL + ciclo de conciliación | `apps/api/src/facturacion-kyros/facturacion-kyros.service.ts` |
| Rutas (panel, webhook, cliente) | `apps/api/src/facturacion-kyros/facturacion-kyros.controller.ts` |
| Migración | `0030_facturacion_kyros.sql` (+ reversa): `accounts.fiscal_*`, `kyros_invoices`, `kyros_invoice_events` (RLS forzada) |
| Panel SuperAdmin | pestaña «Facturación de Kyros» en `/plataforma` (`PlataformaFacturacion.tsx`) |
| Cliente | Suscripción › «Datos para tu factura» y «Mis facturas» (`FacturasDeSuscripcion.tsx`) |
| Pruebas | `test/facturacion-kyros.puro.spec.ts` (cálculos con oráculo `decimal.js`), `test/facturacion-kyros.spec.ts` (flujo completo contra `test/facturasin-doble.ts`, un doble fiel del contrato de FacturaSIN) |

## Flujo
1. SuperAdmin aprueba el pago (`POST /plataforma/pagos/:id/aprobar`): se activa la suscripción (transacción existente) y **después** `alValidarPago` pide la factura sin bloquear ni fallar la aprobación.
2. Núcleo `emitirFactura`: carga datos fiscales → clave de idempotencia `gestro:suscripcion-<idPago>` (más `:r<n>` solo tras un rechazo del SIN) → fila `kyros_invoices` en `emitiendo` → `POST /invoices` (SDK de FacturaSIN, `X-Empresa-Externa: gestro:kyros-tech`) → guarda `cuf`, número, QR, IVA de FacturaSIN y aviso «Ambiente de pruebas / sin validez fiscal».
3. Estados locales: `pendiente` (sin emitir: sin datos, FacturaSIN caído, error de datos), `emitiendo`, `en_proceso` (pendiente/contingencia en el SIN), `emitida`, `observada`, `rechazada`, `anulada`. «Simulada» es la marca `test_environment` de las emitidas.
4. Fallos: red/5xx → `pendiente` reintentable (el ciclo reintenta con espera 2^n min, máx. 60, hasta 12 intentos); 401/403/422/409 → `pendiente` no reintentable (corregir credencial o datos); `SIAT_RECHAZO` → `rechazada` (el botón «Reintentar» usa otra clave).
5. Retorno: `POST /api/v1/webhooks/facturasin` (público, solo por firma HMAC del cuerpo crudo, anti-replay 5 min, rotación con 2 secretos, deduplicación por `X-FacturaSIN-Event-Id`, transiciones sin retroceso; `anulada` manda). Además el ciclo (cada 5 min) concilia las `en_proceso`, reintenta las pendientes y emite las que nunca se intentaron.

## Panel «Facturación de Kyros» (solo equipo de plataforma; el dueño de un restaurante recibe 403)
Lista de pagos validados con su estado de factura, filtros (estado, cliente/NIT, mes del pago), totales (cobrado, facturado, IVA, anulado, por facturar) con **recálculo independiente en SQL** y control cruzado contra el IVA de FacturaSIN y contra lo cobrado, alertas (1 h = alerta, 24 h = crítica), «Emitir factura», «Reintentar», «Emitir como consumidor final», anular con motivo (1-4) y comentario, ver PDF/XML/QR (por GESTRO; FacturaSIN no se expone al navegador), exportar CSV (celdas de texto con `'` delante si empiezan por `= + - @`, tab o salto), aviso permanente de ambiente de pruebas, y auditoría en `audit_log` (`facturacion_kyros.*`). Configuración y secretos exigen confirmar identidad (ventana de 15 min).

## Puesta en marcha (depende del dueño)
1. Kyros ID: el client `gestro-service` ya debe existir con audiencia `facturasin-api`. Pegar su secreto en **Plataforma › Integraciones › `KYROS_SERVICE_CLIENT_SECRET`** (cifrado, solo escritura; nunca en variables de entorno).
2. FacturaSIN (Coolify): `SEMBRAR_SIMULADAS=1` (o `POST /api/v1/admin/seed-simulated`) para crear Kyros-Tech SIMULADO con `gestro:kyros-tech` y sus productos `SUSC-MENSUAL`/`SUSC-ANUAL`.
3. Plataforma › Facturación de Kyros › «Activar» (por defecto APAGADA) y «Suscribir webhook».
Valores por defecto (`CONFIG_POR_DEFECTO`): URL `https://facturasin.kyros-tech.com/api`, sector 1, sucursal 0, punto de venta 0, método de pago 7 (transferencia; confirmar con el contador, pregunta Q4), producto `SUSC-MENSUAL`.

## Replicar en Medyx, Dental, Vet, AXION, Hub, Glucora (fase 4)
Copia `nucleo/` tal cual (cero dependencias; solo `node:crypto` y `fetch`) y escribe tres cosas propias:
1. **Un `AlmacenFacturas`** (3 métodos: `obtener`, `iniciarIntento`, `guardarResultado`) sobre tu base. Copia la migración `0030` (una fila por pago, `payment_id UNIQUE`, centavos `BIGINT`).
2. **Un `PagoFacturable`** desde tu tabla de pagos (monto cobrado en centavos, plan, meses, datos fiscales del cliente).
3. **El enlace**: llama `emitirFactura({ almacen, cliente, config }, pago)` justo después de validar el pago, dentro de un `try/catch` que nunca relance. Cambia `config.sistema` (`medyx`, `dental`…) y el `client_credentials` de tu `<sistema>-service`.
Ejemplo mínimo: `nucleo/ejemplo-otro-sistema.ts`. Panel, webhook y ciclo se copian del servicio (cambia solo los nombres de tabla). Cada sistema debe estar en la lista de sistemas de FacturaSIN con su empresa `<sistema>:kyros-tech` enlazada (el sembrado simulado ya las crea para los 8 sistemas; `hub-service` aún falta en Kyros ID, brecha F12).

## Límites conocidos
- SIN real: apagado (FacturaSIN F5 pendiente). NIT simulado.
- Notas de crédito/débito no existen en FacturaSIN (F6): una factura mal emitida solo se **anula** (plazo: día 9 del mes siguiente).
- Tipo de factura fijo «con crédito fiscal» (F10: consultar al contador si aplica a todos los clientes).
- Código de producto, actividad económica y método de pago son marcadores de simulación (Q4).
- `consumidor final` (CI 0 / «S/N») sin verificar con el SIN.
