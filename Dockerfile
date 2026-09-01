# Imagen de producción de la API. Multi-stage a propósito: `sharp` (la
# librería de procesamiento de imágenes) es una devDependency que SOLO se usa
# en el CLI local `pnpm images:ingest` — la ingesta de imágenes es una
# herramienta local, nunca corre en producción. El stage `deps` la instala
# solo para que `nest build` pueda resolver sus tipos; el stage final
# `runtime` parte de una instalación `--prod`, que por definición la omite.
# Ver docs/product-images.md.

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

# ---- deps: todas las dependencias (incl. devDependencies, para compilar) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: cliente Prisma + compilación TypeScript ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src
# Dummy: prisma.config.ts la exige presente, pero `generate`/`build` no
# conectan a ninguna base de datos real.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm run db:generate
RUN pnpm run build

# ---- prod-deps: SOLO dependencias de producción (sin sharp) ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ---- runtime: imagen final ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

# Documental: el puerto real lo decide PORT (via .env), 8080 por convención
# de este repo.
EXPOSE 8080
ENTRYPOINT ["./docker/entrypoint.sh"]
