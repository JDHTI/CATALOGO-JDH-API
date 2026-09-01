#!/bin/sh
set -e

# Si no llega DATABASE_URL ya armada (despliegue real: la da el operador),
# se arma desde las variables sueltas de Postgres — asi el mismo compose.yaml
# no necesita repetir credenciales que ya viven en docker/env/postgres.env.
if [ -z "$DATABASE_URL" ] && [ -n "$POSTGRES_USER" ]; then
  export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST:-postgres}:${POSTGRES_PORT:-5432}/${POSTGRES_DB}?schema=public"
fi

node_modules/.bin/prisma migrate deploy
exec node dist/src/main
