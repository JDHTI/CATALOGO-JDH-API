#!/bin/sh
# Crea la base de datos de SESIONES que usa la UI (jdh-catalogo-ui).
#
# La autenticación no vive en esta API: la resuelve Better Auth dentro del
# Next.js del catálogo, que necesita su propio Postgres para las tablas
# `user`, `session`, `account`, `verification` y `rateLimit`. En vez de levantar
# un segundo contenedor solo para eso, se reutiliza ESTE motor con una base
# aparte.
#
# Base aparte y no un esquema dentro de `jdh_catalogo`: así un
# `prisma migrate reset` de esta API —que borra su base entera— no puede
# llevarse por delante las sesiones y las contraseñas de los clientes. Las dos
# bases no comparten nada; el vínculo entre una cuenta y su cliente del ERP es
# el campo `clienteId`, que la UI resuelve por código, no con un JOIN.
#
# Postgres ejecuta /docker-entrypoint-initdb.d/* SOLO cuando el volumen de
# datos está vacío, así que esto cubre entornos nuevos. En uno que ya existía
# hay que crearla a mano una vez:
#
#   docker exec jdh-catalogo-postgres \
#     psql -U jdh_catalogo -d postgres -c 'CREATE DATABASE jdh_auth OWNER jdh_catalogo'
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<EOSQL
SELECT 'CREATE DATABASE jdh_auth OWNER $POSTGRES_USER'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'jdh_auth')\gexec
EOSQL

echo "[init] Base 'jdh_auth' lista (sesiones de jdh-catalogo-ui)."
