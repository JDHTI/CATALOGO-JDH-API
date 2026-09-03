# Infraestructura de desarrollo

## Arranque

```bash
cp .env.example .env
for f in docker/env/*.env.example; do cp "$f" "${f%.example}"; done   # PowerShell: ver README
pnpm docker:up
pnpm db:generate
pnpm start:dev
```

## Servicios de `compose.yaml`

| Servicio          | Puerto host | Credenciales / notas                                     |
| ----------------- | ----------- | -------------------------------------------------------- |
| `postgres`        | `5435`      | Dos bases: `jdh_catalogo` (Prisma, esta API) y `jdh_auth` (sesiones de la UI, ver abajo). `docker/env/postgres.env` |
| `redis`           | `6380`      | Caché, con `requirepass`. `docker/env/redis.env`          |
| `redis-commander` | `8081`      | UI web (usuario `jdh_catalogo`). `docker/env/redis-commander.env` |
| `minio`           | `9000`      | API S3-compatible. `docker/env/minio.env`                 |
| `minio` (consola) | `9001`      | UI web de MinIO                                           |
| `minio-init`      | —           | Job de un solo uso: crea el bucket `jdh-catalogo`         |
| `api`             | `8080`      | La API misma, en su imagen Docker (ver «Imagen de producción» abajo) |

El Datawarehouse **no** se levanta en compose: es un Postgres externo y es
**opcional**. Sus credenciales se configuran con las variables `DWH_*` del
`.env`; ninguna está validada ni es obligatoria para arrancar.

## Autenticación: `jdh_auth`

**La autenticación no vive en esta API.** La resuelve Better Auth dentro del
Next.js del catálogo (`jdh-catalogo-ui`), con dos proveedores: Entra ID para el
personal JDH y email + contraseña para las cuentas de cliente. Esta API no
tiene guards, ni sesiones, ni endpoints privados todavía; todos sus endpoints
son públicos.

Lo único que aporta este repo es **dónde se guardan esas sesiones**: la base
`jdh_auth`, en el mismo contenedor `postgres` de arriba. La crea
`docker/postgres/init/01-crear-base-auth.sh` en el primer arranque; el esquema
(`user`, `session`, `account`, `verification`, `rateLimit`) lo aplica la UI con
`pnpm auth:migrate`.

Base aparte y no un esquema dentro de `jdh_catalogo`: así un
`prisma migrate reset` de esta API —que borra su base entera— no puede
llevarse por delante las sesiones y las contraseñas de los clientes. Las dos
bases no comparten nada. El vínculo entre una cuenta y su cliente del ERP es el
campo `clienteId` de la tabla `user`, que la UI resuelve por código.

En un entorno que ya existía antes de este script, el volumen de datos no está
vacío y Postgres no lo ejecuta. Hay que crear la base una vez a mano:

```bash
docker exec jdh-catalogo-postgres \
  psql -U jdh_catalogo -d postgres -c 'CREATE DATABASE jdh_auth OWNER jdh_catalogo'
```

La UI la consume con su propio `DATABASE_URL`, que apunta a este contenedor:

```
DATABASE_URL=postgres://jdh_catalogo:<clave de docker/env/postgres.env>@localhost:5435/jdh_auth
```

> Si el `.env` de este repo trae `AUTH_MICROSOFT_ENTRA_ID_*` o
> `BETTER_AUTH_SECRET`, son restos de una copia: **esta API no las lee**. Su
> sitio es el `.env.local` de `jdh-catalogo-ui`.

## Credenciales de desarrollo

Cada servicio tiene su propia contraseña generada; no se comparten entre
servicios. Están en los `*.env.example`, que se copian tal cual — no hay que
rellenar nada a mano.

Como una misma credencial aparece en dos sitios, si cambias alguna hay que
tocar ambos:

| Credencial      | Se define en                    | Se consume en                        |
| --------------- | ------------------------------- | ------------------------------------ |
| Postgres        | `docker/env/postgres.env`       | `DATABASE_URL` del `.env` **y** `DATABASE_URL` del `.env.local` de `jdh-catalogo-ui` (base `jdh_auth`) |
| Redis           | `docker/env/redis.env`          | `REDIS_PASSWORD` del `.env` **y** `REDIS_HOSTS` de `redis-commander.env` |
| MinIO           | `docker/env/minio.env`          | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` del `.env` |
| UI de Commander | `docker/env/redis-commander.env`| solo la UI                           |

Son credenciales locales de desarrollo, por eso van versionadas en los
`.example`. Para otros entornos, genera unas nuevas y no las versiones.

## Arquitectura de carpetas

```
src/
├── common/                     Transversal, sin dependencias de infraestructura
│   ├── constants/              Constantes de dominio y claves de caché
│   ├── dto/                    DTOs compartidos (paginación, ...)
│   ├── filters/                Filtros de excepción globales
│   └── interceptors/           Interceptores globales
│
├── infrastructure/             Detalles técnicos, intercambiables
│   ├── config/                 Carga + validación de env por namespace
│   ├── database/               PrismaService — BD propia del catálogo
│   ├── datawarehouse/          DatawarehouseService — pool `pg` de solo lectura
│   ├── cache/                  CacheService sobre Redis (ioredis)
│   ├── storage/                StorageService S3/MinIO (@aws-sdk/client-s3)
│   └── infrastructure.module.ts
│
├── modules/                    Módulos de dominio
│   └── health/                 Estado de la API y de sus dependencias
│
├── app.module.ts
└── main.ts

docker/env/                     Variables de entorno de cada contenedor
prisma/                         Schema y migraciones del catálogo
generated/prisma/               Cliente Prisma generado (no se versiona)
```

### Reglas de dependencia

- `common` no importa de `infrastructure` ni de `modules`.
- `modules` consume `infrastructure` a través de sus servicios inyectables.
- `infrastructure` nunca importa de `modules`.

Los módulos de infraestructura son `@Global()`, así que los módulos de dominio
solo inyectan el servicio que necesitan sin importar nada extra.

## Configuración

`src/infrastructure/config` valida todo el entorno al arrancar con
`class-validator` (`env.validation.ts`). Si falta una variable o tiene un tipo
inválido el proceso muere con el detalle de los errores — nunca arranca a medias.

Cada preocupación se expone como namespace tipado:

```ts
const redis = configService.getOrThrow<RedisConfig>(REDIS_CONFIG);
```

## Datawarehouse

`DatawarehouseService` mantiene un pool `pg` independiente de Prisma, con
`search_path` fijado al `DWH_SCHEMA` y `statement_timeout` propio. Expone:

- `query<T>(sql, params)` — SELECT parametrizado.
- `queryOne<T>(sql, params)` — primera fila o `null`.
- `stream<T>(sql, params, batchSize)` — recorre resultados grandes por lotes.
- `withClient(handler)` — cliente dedicado para cursores o sesiones.

### Es opcional

El DWH solo se necesita para importar/sincronizar datos, así que **ninguna
variable `DWH_*` se valida al arrancar**:

- Sin `DWH_HOST` no se crea ningún pool. `service.enabled` es `false`,
  `/health` reporta `"datawarehouse": "disabled"` (sin degradar el estado) y
  cualquier llamada a `query`/`withClient` lanza un `503` explícito pidiendo
  configurar las `DWH_*`.
- Con `DWH_HOST` pero el servidor caído, se registra un warning al arrancar y la
  API sigue en pie; `/health` lo marca `down` y el estado global pasa a
  `degraded`.

El catálogo debe poder servir sin la sincronización.

## Prisma

El generador está fijado a `moduleFormat = "cjs"` y `runtime = "nodejs"`. Sin
eso, Prisma 7 emite ESM y el cliente compilado falla al ejecutarse desde `dist`.

La conexión usa el driver adapter `@prisma/adapter-pg`, obligatorio en Prisma 7.

El compilador de consultas de Prisma 7 se carga con `import()` dinámico, así que
Jest se ejecuta con `node --experimental-vm-modules` (ya incluido en los scripts
`test*` de `package.json`).

## Imagen de producción (Docker)

`Dockerfile` es multi-stage: compila con todas las dependencias (incluida
`sharp`, solo para que `nest build` resuelva sus tipos) y el stage final
instala únicamente dependencias de producción — `sharp` queda fuera, así que
la ingesta de imágenes (`pnpm images:ingest`, ver `docs/product-images.md`)
es imposible de correr dentro de ese contenedor.

`docker/entrypoint.sh` corre `prisma migrate deploy` antes de arrancar
(`prisma` está en `dependencies`, no en `devDependencies`, justo para que esto
funcione) y arma `DATABASE_URL` desde `POSTGRES_*` cuando no llega ya
resuelta — así el servicio `api` de `compose.yaml` no repite credenciales que
ya viven en `docker/env/postgres.env`.

```bash
docker compose up -d --build api   # o simplemente: pnpm docker:up
```

Dentro de la red de compose, la API habla con `postgres`/`redis`/`minio` por
nombre de servicio; eso solo aplica al contenedor — corriendo en el host
(`pnpm start:dev`) se sigue usando `localhost` con los puertos publicados.

## Verificación

```bash
curl http://localhost:8080/api/v1/health
# {"status":"ok","dependencies":{"database":"up","datawarehouse":"disabled",
#  "cache":"up","storage":"up"},...}
```

Swagger queda en `http://localhost:8080/api/docs` (solo fuera de producción).
