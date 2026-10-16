#!/usr/bin/env bash
# Crea la CA raíz interna que usa Caddy para firmar los certificados de
# *.jdh.local. Corre UNA sola vez por servidor: si ya existe, no hace nada.
#
#   deploy/scripts/init-ca.sh
#
# Resultado (no versionado, ver .gitignore):
#   deploy/caddy/ca/root.crt  → se distribuye por GPO (público)
#   deploy/caddy/ca/root.key  → SECRETO. Respaldar fuera del servidor.
#
# ¿Ya existe una CA de JDH (la de intranet.jdh.local)? NO correr este script:
# copiar su root.crt y root.key a deploy/caddy/ca/ (permisos 644 y 600). Así
# los equipos que ya confían en ella (GPO) confían también en este servidor y
# no hay que distribuir nada nuevo.
set -euo pipefail

cd "$(dirname "$0")/../caddy"
mkdir -p ca
chmod 700 ca

if [[ -f ca/root.crt && -f ca/root.key ]]; then
  echo "La CA ya existe: $(openssl x509 -in ca/root.crt -noout -subject -enddate)"
  exit 0
fi

cat > ca/openssl.cnf <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
CN = JDH Intranet Root CA
O = Juan D. Hoyos Distribuciones
OU = Tecnologia
C = CO

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
# Solo puede firmar nombres bajo jdh.local: si la llave se filtrara, no sirve
# para interceptar ningún otro dominio en los equipos que confían en ella.
# (RFC 5280: una restricción DNS cubre el dominio y todos sus subdominios.)
nameConstraints = critical, permitted;DNS:jdh.local
EOF

openssl ecparam -name prime256v1 -genkey -noout -out ca/root.key
openssl req -new -x509 -sha256 -days 3650 -key ca/root.key -config ca/openssl.cnf -out ca/root.crt
rm ca/openssl.cnf
chmod 600 ca/root.key
chmod 644 ca/root.crt

echo "CA creada:"
openssl x509 -in ca/root.crt -noout -subject -enddate -fingerprint -sha256
