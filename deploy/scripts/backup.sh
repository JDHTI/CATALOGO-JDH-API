#!/usr/bin/env bash
# Respaldo de los datos del catálogo en ~/backups/<fecha>-<etiqueta>/:
#   jdh_catalogo.dump   (catálogo, Prisma — pg_dump -Fc)
#   jdh_auth.dump       (Better Auth: usuarios, sesiones, clave JWT — pg_dump -Fc)
#   storage.tar.gz      (imágenes, logos y banners — bucket RustFS)
#
#   deploy/scripts/backup.sh [etiqueta]     # etiqueta por defecto: daily
#
# Retención: 14 respaldos diarios y 10 pre-deploy. Cron sugerido (crontab -e
# del usuario tienda): 30 2 * * * ~/apps/CATALOGO-JDH-API/deploy/scripts/backup.sh daily
# (lo instala bootstrap-server.sh). Redis es caché: no se respalda.
#
# Esto protege contra borrados/errores, NO contra la pérdida del servidor:
# copiar ~/backups fuera de esta VM (NAS, R2, etc.), junto con deploy/.env y
# deploy/caddy/ca/root.key.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

label=${1:-daily}
root="$HOME/backups"
dest="$root/$(date +%Y%m%d-%H%M%S)-$label"
mkdir -p "$dest"
chmod 700 "$root" "$dest"

docker exec tienda-postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$dest/$POSTGRES_DB.dump"
docker exec tienda-postgres pg_dump -U "$POSTGRES_USER" -Fc "${AUTH_DB_NAME:-jdh_auth}" > "$dest/${AUTH_DB_NAME:-jdh_auth}.dump"

# Volumen de archivos, leído en caliente con un contenedor efímero.
docker run --rm -v "tienda-jdh_storage_data:/src:ro" -v "$dest:/out" alpine:3 \
  tar -czf /out/storage.tar.gz -C /src .

keep() {
  local pattern=$1 count=$2
  # Nombres con fecha ordenable: el orden inverso deja primero los recientes.
  find "$root" -mindepth 1 -maxdepth 1 -type d -name "*-$pattern" -printf '%f\n' \
    | sort -r | tail -n +$((count + 1)) | sed "s|^|$root/|" | xargs -r rm -rf
}
keep daily 14
keep pre-deploy 10

du -sh "$dest" | awk '{print "Respaldo: " $2 " (" $1 ")"}'
