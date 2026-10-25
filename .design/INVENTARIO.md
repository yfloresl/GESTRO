# Inventario de componentes (F0)

Estado: `usado` entra a código · `derivado` se construyó a partir de tokens/patrones · `no usado` queda documentado.

| Componente | Pantallas | Estado | Notas |
|---|---|---|---|
| Barra lateral (logo, sucursal activa, 3 grupos de navegación, nodo KDS/POS) | 5.1–5.10 | usado | w-72, `bg-surface-container-low`, ítem activo `bg-primary-container` |
| Cabecera (selector de sucursal, estado SIAT, hora BOST, usuario) | 5.x | usado | Estado SIAT oculto hasta tener servicio fiscal (F1+) |
| Menú de cuenta (nombre, rol, Seguridad, Portal, Salir) | estándar Kyros | derivado | `app-interna-estandar.md` §2; patrón del selector y avatar de la cabecera |
| Pantalla de ingreso «Entrar con Kyros ID» / «Crear mi cuenta» | — | derivado | Tarjeta `bg-surface-container-lowest`, botones primario 56 px |
| Completa tu registro / Código de invitación | — | derivado | Mismos inputs de 52 px del DESIGN.md |
| Estado vacío «Módulo en construcción» | — | derivado | Para módulos de F1+ |
| Tarjetas KPI, gráficos, FODA, alertas del panel del dueño | 5.1 | no usado (F5) | Se construyen con los datos reales de cada fase |
| KDS, POS, QR de mesa, caja, etc. | 1.x–4.x | no usado (F1+) | |
| Menú digital del cliente (cabecera, buscador, chips de categoría, tarjeta de plato, «Agotado hoy», barra de acciones) | 1.1 | usado | Sin «Agregar» ni «Mi pedido» hasta F1b |
| Hoja de solicitud (comentario ≤ 300) | 1.1 / 2.2 | derivado | Bottom sheet con tokens de modal del diseño |
| Mapa de mesas (cuadro numerado, estados llamado / cuenta) | 2.1 | usado | Libres/ocupadas/reserva llegan con pedidos (F1b) |
| Tarjeta de llamado con «Atendido» | 2.2 | usado | Tonos `error-container`; contador de minutos |
| Menú & Fotos: lista, filtros y ficha lateral | 5.2 | usado | Sin costeo, margen ni código SIN (F2 / servicio fiscal) |
| Personal: tarjetas con rol, estado y código de invitación | 5.7 | derivado | Turnos y asistencia llegan en una fase posterior |
| Aviso de activación de notificaciones (Android / iPhone) | — | derivado | Instrucciones de instalación en iPhone |
| Hoja imprimible de QR por mesa | 5.6 | derivado | El editor de plano arrastrable queda para después |
| Toma de pedidos (menú táctil, panel del pedido, hoja de notas y modificadores) | 2.3, 2.4, 2.5 | usado | Tipos mesa / mostrador / llevar / delivery en un solo flujo |
| Lista de pedidos del día | 2.6 | usado | Filtros «En curso» y «Todos los de hoy» |
| Anular plato con motivo | 2.7 | derivado | Sin PIN de supervisor: exige rol y motivo (el PIN queda para después) |
| Tablero de cocina (KDS, modo oscuro) | 3.1 | usado | Sin panel de insumos críticos ni «Declarar agotado (+86)» hasta F2 |
| Caja: apertura, cobros por método y arqueo | 4.1, 4.3 | derivado | Sin teclado numérico grande ni división de cuenta todavía |
| Recibo imprimible (80 mm) | 4.1 | derivado | Rotulado «RECIBO — NO ES UNA FACTURA» |
| Pedido del cliente: «Agregar», «Mi pedido» y semáforo de avance | 1.1, 1.3, 1.4 | usado | Sin pago por QR dentro del cliente (1.5) hasta F3 |
| Suscripción: estado, QR de cobro, declaración de pago y comprobante, historial | 6.1 | usado | Sin pago automático: validación manual por Kyros-Tech |
| Aviso de vencimiento / solo lectura (franja superior) | 6.1 | derivado | Tonos `secondary-fixed` (por vencer) y `error-container` (vencida) |
| Consola de plataforma: pagos con comprobante, sucursales, planes, promociones, cobro | 6.2 | usado | Sin gráficos de ingresos ni métricas de uso (llegan con estadísticas) |

