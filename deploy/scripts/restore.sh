#!/usr/bin/env bash
# Restaura una base de Postgres del stack desde un dump `pg_dump -Fc`.
#
#   deploy/scripts/restore.sh <base> <archivo.dump> [--yes]
#
#   <base>   jdh_catalogo (catálogo) | jdh_auth (Better Auth)
#
# Sirve para recuperar un respaldo de ~/backups y para sembrar el catálogo
# desde otra instancia (p. ej. el dump de la base de desarrollo):
#   pg_dump -Fc -h localhost -p 5435 -U jdh_catalogo jdh_catalogo > catalogo.dump
#   scp catalogo.dump tienda@tienda.jdh.local:~
#   deploy/scripts/restore.sh jdh_catalogo ~/catalogo.dump
#
# Detiene la API y la UI durante la restauración y las vuelve a levantar.
# BORRA el contenido actual de la base (pg_restore --clean).
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

db=${1:?Falta la base (jdh_catalogo | jdh_auth)}
file=${2:?Falta el archivo .dump}
confirm=${3:-}

case $db in
  "$POSTGRES_DB"|"${AUTH_DB_NAME:-jdh_auth}") ;;
  *) echo "Base desconocida: $db" >&2; exit 2 ;;
esac
[[ -f $file ]] || { echo "No existe: $file" >&2; exit 2; }

if [[ $confirm != --yes ]]; then
  read -r -p "Esto REEMPLAZA la base '$db'. Escribe 'si' para continuar: " answer
  [[ $answer == si ]] || { echo "Cancelado."; exit 1; }
fi

COMPOSE=(docker compose -f compose.prod.yaml --env-file .env)

"${COMPOSE[@]}" stop ui api
docker exec -i tienda-postgres pg_restore -U "$POSTGRES_USER" -d "$db" \
  --clean --if-exists --no-owner --no-privileges < "$file"
"${COMPOSE[@]}" start api ui
echo "Restaurada $db desde $file"
