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
| `postgres`        | `5435`      | BD propia del catálogo (Prisma). `docker/env/postgres.env` |
| `redis`           | `6380`      | Caché, con `requirepass`. `docker/env/redis.env`          |
| `redis-commander` | `8081`      | UI web (`admin`/`admin`). `docker/env/redis-commander.env` |
| `minio`           | `9000`      | API S3-compatible. `docker/env/minio.env`                 |
| `minio` (consola) | `9001`      | UI web de MinIO                                           |
| `minio-init`      | —           | Job de un solo uso: crea el bucket `jdh-catalogo`         |

El Datawarehouse **no** se levanta en compose: es un Postgres externo y es
**opcional**. Sus credenciales se configuran con las variables `DWH_*` del
`.env`; ninguna está validada ni es obligatoria para arrancar.

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

## Verificación

```bash
curl http://localhost:3000/api/v1/health
# {"status":"ok","dependencies":{"database":"up","datawarehouse":"disabled",
#  "cache":"up","storage":"up"},...}
```

Swagger queda en `http://localhost:3000/api/docs` (solo fuera de producción).
