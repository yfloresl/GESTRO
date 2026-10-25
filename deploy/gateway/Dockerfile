# syntax=docker/dockerfile:1
# Gateway: único servicio con dominio. Compila la web (Vite), la sirve como archivos estáticos y
# reenvía /api/ a la API por la red interna. Contexto de build: la RAÍZ del repositorio.
FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.11.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN NODE_ENV=development pnpm install --frozen-lockfile --config.trustLockfile=true --filter @gestro/web...
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm --filter @gestro/web build

FROM nginx:1.27-alpine AS runtime
COPY deploy/gateway/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/gateway/cabeceras.conf /etc/nginx/cabeceras.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1
