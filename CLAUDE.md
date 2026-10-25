# CLAUDE.md · Reglas del proyecto GESTRO

GESTRO es el Sistema de Gestión de Restaurantes de Kyros-Tech (SaaS multi-sucursal). Fuente de la especificación: `docs/Sistema_Gestion_Restaurantes_Proyecto_Tecnico_v2_1.docx` y `docs/ddl-original.sql`. Diseño: `.design/` (fuente de verdad visual).

**El estándar Sistemas-Kyros manda sobre el documento v2.1** cuando chocan (decisión del dueño, 2026-10-25).

## Stack (Sistemas-Kyros)
- Monorepo pnpm + Turborepo, `packageManager pnpm@11.11.0`, **Node 22-slim** (nunca Node 20).
- `apps/api`: NestJS 10 + TypeScript estricto + **Drizzle** (no TypeORM, no Prisma) + Postgres 16. Migraciones SQL versionadas en `src/database/migraciones/`, cada una con su reversa en `reversas/`; se aplican solas al arrancar.
- `apps/web`: React 18 + Vite + TanStack Query + React Router + Tailwind. Una sola web con áreas por ruta: `/m` (cliente QR), `/app` (personal y dueño), `/plataforma`.
- `packages/contracts` (Zod y tipos compartidos) y `packages/sdk` (cliente tipado). La API **solo importa tipos** de `contracts`.
- Despliegue: Docker Compose en Coolify (`gestro.kyros-tech.com`), dominio solo en `gateway`.

## Reglas de oro
1. **Cero variables de entorno con secretos.** Ni `.env`, ni panel de Coolify, ni `environment:` del compose. Solo `src/config/entorno.ts` lee el entorno, y solo literales no secretos. Los secretos viven cifrados (AES-256-GCM) en `app_config`; la llave maestra se genera sola en el volumen `gestro_secretos`.
2. **Identidad solo con Kyros ID** (Code + PKCE S256). Vínculo por `sub`, **nunca por correo**. Roles y sucursales salen de GESTRO, nunca de claims del emisor. El QR de mesa usa token de mesa (aud `table`), no Kyros ID.
3. **RLS en toda tabla con `restaurant_id` o `client_app_id`**, forzada. La API conecta como dueño de tablas y en cada transacción de negocio hace `SET LOCAL ROLE app_user` (NOBYPASSRLS) vía `TenantDb.run`. Hay una prueba que verifica el 100 %.
4. Dinero: `NUMERIC` en base y `decimal.js` o centavos enteros en código. Nunca float.
5. Todo cuerpo se valida con Zod `.strict()`. Consultas siempre parametrizadas.
6. El stock solo cambia por `stock_movements`. Los asientos contables son de partida doble y los publicados no se editan.
7. Cada endpoint declara sus guards (`@DeSucursal(roles…)`, `@Publico()`); cada acción sensible escribe en `audit_log`.
8. Textos al usuario en español; código y comentarios técnicos en inglés o español claro como el resto del repo.
9. **Nada de valores visuales fuera de `apps/web/tokens.json`.** Lo que no está en el diseño se deriva de los tokens y se anota en `.design/INVENTARIO.md` como `derivado`.
10. Cada historia termina con: código + pruebas + migración reversible + OpenAPI + sin avisos de seguridad nuevos.

## Cómo trabajar
- Cambios mayores: cuestionario y resumen aprobado antes de programar (skill `optimizayentiende`).
- Servicio Fiscal SIN: **no se implementa de memoria**. Va en otro repositorio sobre los documentos oficiales del SIAT en `docs/sin/`.
- Comandos: `pnpm install` · `pnpm db:arriba` · `pnpm dev:api` · `pnpm dev:web` · `pnpm typecheck` · `pnpm test` · `pnpm build`.
