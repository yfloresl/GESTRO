# GESTRO — Cierre de seguridad (QA pre-final, 2026-11-12)

Revisión según `security-hardening-standard.md`. Marca: ✔ cerrado y verificado · ⚠ pendiente.

## Cerrado
| Tema | Estado | Evidencia |
|---|---|---|
| Autorización por rol/sucursal en cada ruta | ✔ | `JwtAuthGuard` global; toda ruta declara `@DeSucursal(roles)`, `@SoloPlataforma()` o `@Publico()`. Un barrido de controladores solo encontró 6 rutas autenticadas sin rol, todas sobre datos propios (`/auth/yo`, `/legal/estado`, `/legal/aceptar`, 3 de push). El servidor valida; la web además oculta y bloquea la ruta. |
| Aislamiento por sucursal (RLS) | ✔ | RLS forzada en toda tabla con `restaurant_id`; `SET LOCAL ROLE app_user` en cada transacción; prueba que verifica el 100 % |
| Demo confinada | ✔ | Sucursal `is_demo` aislada del resto; modo QA con escritura (interruptor de plataforma, auditado, ON durante el QA) con pagos de suscripción y acciones de plataforma siempre bloqueados; con OFF solo lectura (403). Cuentas exentas solo de los bloqueos legales, no entran sin la demo cargada, reinicio auditado |
| Rol de plataforma | ✔ | Claim exacto leído solo del token verificado; sesión ≤60 min; no entra por la app móvil ni crea cuentas con privilegio persistido; secretos con reautenticación ≤15 min |
| Identidad | ✔ | PKCE S256, vínculo por `sub` (nunca por correo), `jti` de un solo uso, lista cerrada de clients (web + `gestro-mobile`), respuesta uniforme «No pudimos verificar tu ingreso», 10 intentos/min por IP |
| Secretos | ✔ | AES-256-GCM en `app_config`, llave maestra en volumen privado, catálogo cerrado de integraciones (solo escritura), ningún valor devuelto ni auditado; `git grep` sin claves/llaves en el repo; sin `process.env` fuera de `entorno.ts` (solo el flag de pruebas) |
| Cabeceras (gateway) | ✔ | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff` |
| Límites de tasa | ✔ | Global 120/min; ingreso y registro 10/min; QR y reservas públicas con límite propio |
| Swagger | ✔ | Solo fuera de producción |
| Archivos e imágenes | ✔ | Validación por bytes (JPG/PNG/WebP, SVG vetado), privados por sucursal, modo 0600, anti path-traversal, `no-store` |
| Aceptación legal | ✔ | Evidencia con versión, fecha/hora y hashes de IP/navegador; el alta se rechaza sin aceptar |
| Validación de entrada | ✔ | Zod `.strict()` en todo cuerpo; consultas parametrizadas; dinero con `NUMERIC` |

## Pendiente
| Tema | Detalle | Plan |
|---|---|---|
| Dependencias | `pnpm audit --prod`: 29 hallazgos transitivos (14 altos): `multer`/`body-parser` (vía NestJS 10), `lodash`, `js-yaml`, `drizzle-orm` 0.36.4 (corregido en ≥0.45.2) y `zod` | Requieren subida mayor de NestJS/Drizzle: PR aparte con migración probada. GESTRO usa plantillas `sql` parametrizadas, sin identificadores armados con entrada de usuario |
| Borrados reales | Varias acciones hacen `DELETE` (menú, insumos, promociones, turnos, asientos en borrador…) | Regla «nada se borra»: PR de deshabilitación ya aprobado |
| Revisión legal | Textos en borrador | Abogado |
| Sin CI | GitHub Actions no disponible | Verificación local en cada PR |
| Prueba de penetración externa | No realizada | Recomendada antes de abrir al público |
