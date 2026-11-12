#!/usr/bin/env bash
# Despliega (o actualiza) el stack del catálogo en este servidor.
#
#   deploy/scripts/deploy.sh            # todo el stack
#   deploy/scripts/deploy.sh ui         # solo un servicio (y lo que necesite)
#   deploy/scripts/deploy.sh api-migrate api
#
# Pasos: respaldo previo de Postgres (si ya corre) → build → up -d →
# verificación de salud a través de Caddy → limpieza de imágenes huérfanas.
# El código de cada repo ya debe estar actualizado en ~/apps/<repo>.
set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f deploy/compose.prod.yaml --env-file deploy/.env)

[[ -f deploy/.env ]] || { echo "Falta deploy/.env (deploy/scripts/gen-env.sh)" >&2; exit 1; }
[[ -f deploy/caddy/ca/root.crt ]] || { echo "Falta la CA (deploy/scripts/init-ca.sh)" >&2; exit 1; }

set -a; . deploy/.env; set +a

if [[ $AUTH_MICROSOFT_ENTRA_ID_ID == pendiente-* || $AUTH_MICROSOFT_ENTRA_ID_SECRET == pendiente-* \
  || $AUTH_MICROSOFT_ENTRA_ID_TENANT_ID == 00000000-* ]]; then
  if [[ ${ALLOW_NO_ENTRA:-0} == 1 ]]; then
    echo "Aviso: Entra ID sin configurar; el ingreso del personal JDH no funcionará." >&2
  else
    echo "Entra ID con valores de relleno en deploy/.env. Completar AUTH_MICROSOFT_ENTRA_ID_*" >&2
    echo "o desplegar sin Entra con ALLOW_NO_ENTRA=1." >&2
    exit 1
  fi
fi

if docker ps --format '{{.Names}}' | grep -qx tienda-postgres; then
  echo "▸ Respaldo previo"
  deploy/scripts/backup.sh pre-deploy
fi

echo "▸ Build"
"${COMPOSE[@]}" build "$@"

echo "▸ Up"
"${COMPOSE[@]}" up -d --remove-orphans "$@"

echo "▸ Verificación"
# Todo se pide a través de Caddy (TLS con la CA interna) sin depender del DNS.
# HTTPS_PORT solo difiere de 443 en máquinas de prueba.
HTTPS_PORT=${HTTPS_PORT:-443}
base="https://$TIENDA_HOST"
[[ $HTTPS_PORT == 443 ]] || base="$base:$HTTPS_PORT"
CURL=(curl --cacert deploy/caddy/ca/root.crt --resolve "$TIENDA_HOST:$HTTPS_PORT:127.0.0.1")

check() {
  local name=$1 url=$2
  for _ in $(seq 1 60); do
    if "${CURL[@]}" -fsS "$url" >/dev/null 2>&1; then
      echo "  ✓ $name"
      return 0
    fi
    sleep 3
  done
  echo "  ✗ $name no respondió: $url" >&2
  return 1
}
ok=0
check "UI        $base" "$base/api/health" || ok=1
check "API       /api/v1/products (vía Caddy)" "$base/api/v1/products?limit=1" || ok=1
if docker exec tienda-ui wget -qO- http://api:8080/api/v1/health/ready >/dev/null 2>&1; then
  echo "  ✓ API (ready: db, redis, storage)"
else
  echo "  ✗ API /health/ready falló" >&2; ok=1
fi

# El JWKS solo debe publicar la clave PÚBLICA: si trae el componente "d" se
# estaría sirviendo la privada.
jwks=$("${CURL[@]}" -fsS "$base/api/auth/jwks" 2>/dev/null || true)
if [[ -z $jwks ]]; then
  echo "  ✗ JWKS $base/api/auth/jwks no respondió" >&2; ok=1
elif grep -q '"d"' <<<"$jwks"; then
  echo "  ✗ JWKS expone la clave PRIVADA (\"d\"): parar y revisar" >&2; ok=1
else
  echo "  ✓ JWKS (solo clave pública)"
fi

# El bucket es de lectura pública: un objeto inexistente debe dar 404/403 de
# RustFS, nunca 502/503 (storage caído o ruta mal configurada).
code=$("${CURL[@]}" -sS -o /dev/null -w '%{http_code}' "$base/media/.verificacion" || true)
if [[ $code =~ ^(200|403|404)$ ]]; then
  echo "  ✓ /media → storage ($code)"
else
  echo "  ✗ /media respondió $code (se esperaba 200/403/404)" >&2; ok=1
fi

# Nombre público (certificado ACME, no la CA interna): solo aviso. Un fallo de
# DNS, puertos o límite de Let's Encrypt no debe tumbar el despliegue, pero sí
# dejar rastro, porque sin él el callback de Entra no funciona.
if [[ -n ${PUBLIC_HOST:-} ]]; then
  pub_ok=0
  for _ in $(seq 1 20); do
    if curl -fsS --resolve "$PUBLIC_HOST:$HTTPS_PORT:127.0.0.1" \
      "https://$PUBLIC_HOST/api/health" >/dev/null 2>&1; then
      pub_ok=1; break
    fi
    sleep 3
  done
  if [[ $pub_ok -eq 1 ]]; then
    echo "  ✓ Nombre público https://$PUBLIC_HOST (certificado válido)"
  else
    echo "  ⚠ https://$PUBLIC_HOST sin certificado válido: revisar DNS público, puertos 80/443 y 'docker logs tienda-caddy'" >&2
  fi
fi

if [[ $ok -ne 0 ]]; then
  "${COMPOSE[@]}" ps
  echo "Revisar: ${COMPOSE[*]} logs --tail 100 <servicio>" >&2
  exit 1
fi

docker image prune -f >/dev/null
echo "▸ Despliegue OK"
