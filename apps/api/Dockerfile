# syntax=docker/dockerfile:1
# API de GESTRO (NestJS). Contexto de build: la RAÍZ del repositorio (monorepo pnpm).
# Estándar Sistemas-Kyros: node:22-slim (pnpm 11.11 exige Node >= 22.13), pnpm instalado con npm.

FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.11.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
# NODE_ENV=development solo durante la instalación: el build necesita @nestjs/cli y typescript.
RUN NODE_ENV=development pnpm install --frozen-lockfile --config.trustLockfile=true --filter @gestro/api...
COPY apps/api ./apps/api
COPY packages ./packages
RUN pnpm --filter @gestro/api build

FROM node:22-slim AS runtime
WORKDIR /app
RUN npm install -g pnpm@11.11.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN pnpm install --frozen-lockfile --config.trustLockfile=true --prod --filter @gestro/api...
COPY --from=build /app/apps/api/dist ./apps/api/dist
# La API solo importa TIPOS de @gestro/contracts: no hace falta en ejecución.
RUN mkdir -p /data/secretos /data/archivos && chown -R node:node /data /app && chmod 700 /data/secretos
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/v1/ready',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
# Las migraciones corren dentro de la propia API al arrancar (main.ts).
CMD ["node", "dist/src/main.js"]
