#!/usr/bin/env bash
# Genera deploy/.env con secretos aleatorios nuevos. Solo para la PRIMERA
# instalación: si deploy/.env ya existe, no lo toca (rotar un secreto es
# editarlo a mano + `deploy.sh` de los servicios que lo usan).
#
#   deploy/scripts/gen-env.sh
#
# Las tres AUTH_MICROSOFT_ENTRA_ID_* vienen del App Registration de Entra. Si
# todavía no existen quedan con valores de relleno (la UI exige que estén
# definidas para arrancar): el ingreso de clientes funciona, el de Entra no.
# Para dejarlas listas desde el principio:
#   AUTH_MICROSOFT_ENTRA_ID_ID=... AUTH_MICROSOFT_ENTRA_ID_SECRET=... \
#   AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=... deploy/scripts/gen-env.sh
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  echo "deploy/.env ya existe; no se sobrescribe." >&2
  exit 1
fi

hex() { openssl rand -hex "${1:-32}"; }

entra_id=${AUTH_MICROSOFT_ENTRA_ID_ID:-pendiente-registrar-en-entra}
entra_secret=${AUTH_MICROSOFT_ENTRA_ID_SECRET:-pendiente-registrar-en-entra}
entra_tenant=${AUTH_MICROSOFT_ENTRA_ID_TENANT_ID:-00000000-0000-0000-0000-000000000000}

umask 077
cat > .env <<EOF
# Generado por deploy/scripts/gen-env.sh el $(date -Iseconds). NO versionar.
# Permisos 600. Plantilla con descripciones: deploy/.env.example

TIENDA_HOST=tienda.jdh.local
DOCKER_SUBNET=172.29.60.0/24

# Postgres (catálogo + Better Auth, misma instancia)
POSTGRES_USER=jdh_catalogo
POSTGRES_PASSWORD=$(hex 24)
POSTGRES_DB=jdh_catalogo
AUTH_DB_NAME=jdh_auth

REDIS_PASSWORD=$(hex 24)

# Almacenamiento S3-compatible (RustFS)
S3_ACCESS_KEY_ID=tienda-$(hex 6)
S3_SECRET_ACCESS_KEY=$(hex 32)
S3_BUCKET=jdh-catalogo

# Better Auth (sesiones + clave de firma de los JWT hacia la API)
BETTER_AUTH_SECRET=$(hex 32)

# Entra ID — App Registration del catálogo
AUTH_MICROSOFT_ENTRA_ID_ID=$entra_id
AUTH_MICROSOFT_ENTRA_ID_SECRET=$entra_secret
AUTH_MICROSOFT_ENTRA_ID_TENANT_ID=$entra_tenant

# API
RATE_LIMIT_MAX=300
SYNC_PRODUCTS_ENABLED=false
# Entre comillas: deploy.sh hace source de este archivo y el cron lleva espacios.
SYNC_PRODUCTS_CRON="0 2 * * *"
DWH_HOST=
DWH_PORT=5432
DWH_DATABASE=
DWH_USER=
DWH_PASSWORD=
DWH_SCHEMA=public
DWH_SSL=false
EOF
echo "deploy/.env creado (600)."
if [[ $entra_id == pendiente-* ]]; then
  echo "Aviso: Entra ID con valores de relleno; el ingreso del personal no funcionará hasta completarlos." >&2
fi
