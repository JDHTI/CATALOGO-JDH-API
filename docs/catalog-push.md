# Publicación del catálogo (local → Railway)

## El problema que resuelve

El datawarehouse solo es alcanzable desde la red interna de JDH. La API
desplegada en Railway no puede sincronizarse sola: su `/health` reporta
`"datawarehouse":"disabled"` y así se queda. El único equipo que ve las dos
puntas es el local, así que la cadena completa tiene dos tramos:

```
DWH ──`pnpm sync:products`──► catálogo local ──`pnpm push:catalogo`──► Railway
     (solo desde la red JDH)                   (desde el mismo equipo)
```

Este documento cubre el segundo tramo. El primero está en
[products-sync.md](./products-sync.md).

## Qué viaja

Todas las **filas** del catálogo, en el orden que exigen las llaves foráneas:

| Entidad         | Clave natural del upsert | Notas                                        |
| --------------- | ------------------------ | -------------------------------------------- |
| `suppliers`     | `code`                   | Incluye `logo_object_key` / `logo_url`        |
| `brands`        | `name`                   | Incluye `logo_object_key` / `logo_url`        |
| `manufacturers` | `name`                   | Solo tienen nombre: nunca se actualizan       |
| `categories`    | `name`                   | Hoy vacías; viajan por si se pueblan          |
| `subcategories` | `(name, category)`       | Con la categoría ya traducida al id de destino |
| `products`      | `producto_key`           | Detección de cambios por hash                 |
| `product_images`| `(producto, posición)`   | Solo referencias, ver abajo                   |

**Los binarios NO viajan.** Las imágenes de producto y los logos ya viven en
Cloudflare R2, que es **el mismo bucket** que usa la instancia desplegada, y
las columnas guardan URLs absolutas (`https://pub-….r2.dev/…`). Publicar la
fila basta para que la imagen se vea en la nube. Si algún día cada ambiente
tiene su propio bucket, esto deja de ser cierto y habría que copiar objetos.

## Por qué no se copian los ids

Los `id` son autoincrementales y **no coinciden entre las dos bases**: el
proveedor `P01` puede ser el id 10 en local y el 4 en Railway. Por eso cada
entidad se resuelve por su clave natural y el push construye un mapa
`idLocal → idDestino` que usa para traducir las llaves foráneas de cada
producto. Es lo que hace que la operación sea repetible sin duplicar nada.

## Idempotencia y detección de cambios

Correr el comando dos veces seguidas no cambia nada: la segunda pasada reporta
todo como `sin cambios`.

En destino, `Product.sourceHash` guarda el **hash de lo último publicado**, no
el hash del DWH. Allá no corre ningún sync (el DWH está deshabilitado), así que
la columna queda libre para este uso: si el hash del producto local coincide
con el de destino, la fila no se reescribe.

El push incluye `long_description`, `seo_title` y `seo_description` dentro de
los campos de producto y de su hash. Estos valores son editoriales: el push los
transporta desde local y no los genera ni los reemplaza con datos del DWH.

El hash cubre todos los campos que viajan, incluidos los que el sync del DWH no
toca (`price`, `categoryId`, …), así que un cambio de precio hecho a mano en
local también se propaga.

## Bajas

- **Productos** que existen en destino y ya no en local se **desactivan**
  (`active = false`), nunca se borran. Mismo criterio que el sync del DWH: el
  soft-delete protege de un error de extracción.
- **Imágenes** que se quitaron en local **sí se borran** en destino: son
  referencias reconstruibles con `pnpm images:ingest`, no datos de negocio.

## Configuración

Una sola variable obligatoria en el `.env` **local**:

```bash
PUSH_TARGET_DATABASE_URL=postgresql://postgres:<clave>@<host>.proxy.rlwy.net:<puerto>/railway
```

Se saca de Railway → servicio **Postgres** → pestaña **Variables** →
`DATABASE_PUBLIC_URL`. Es la cadena que sale por el **proxy TCP público**, no
la `…railway.internal`, que solo resuelve dentro de la red privada de Railway.

Opcionales, con sus valores por defecto:

```bash
PUSH_BATCH_SIZE=1000          # productos por lote
PUSH_CONNECTION_TIMEOUT=20000 # ms; el destino está al otro lado de internet
PUSH_STATEMENT_TIMEOUT=120000 # ms
```

> **Esta variable nunca se define en Railway.** Es una herramienta local; la
> API desplegada no tiene por qué conocer una segunda base. Sin ella,
> `pnpm push:catalogo` se niega a correr y nada más cambia — por eso
> `CatalogPushModule` tampoco está en `AppModule`.

## Cómo correrlo

```bash
# 1. Traer el DWH al catálogo local (requiere red interna JDH)
pnpm sync:products

# 2. Prueba de humo: publica 50 productos y revisa que se vean
pnpm push:catalogo -- --limit=50

# 3. Publicación completa
pnpm push:catalogo
```

Banderas:

| Bandera         | Efecto                                                              |
| --------------- | ------------------------------------------------------------------- |
| `--limit=N`     | Publica solo los primeros N productos. **Omite la desactivación**, para que una prueba parcial no apague el resto del catálogo. |
| `--skip-images` | Salta por completo la fase de imágenes.                              |

Salida de ejemplo:

```
Publicación #1 OK en 96s
  proveedores      645 leídos     645 nuevos       0 actualizados       0 sin cambios
  marcas          1204 leídos    1204 nuevos       0 actualizados       0 sin cambios
  productos      27476 leídos   27476 nuevos       0 actualizados       0 sin cambios
  imágenes         312 leídos     312 nuevos       0 actualizados       0 sin cambios
  productos desactivados en destino: 0
  imágenes eliminadas en destino:    0
```

## Verificación

```bash
curl https://catalogo-jdh-api-production.up.railway.app/api/v1/products?limit=1
```

Cada corrida deja además un `SyncRun` con `type='catalog-push'` **en la base
destino**, con contadores o con el mensaje de error si falló.

> La API desplegada cachea sus respuestas en Redis: los cambios pueden tardar
> hasta `REDIS_DEFAULT_TTL` (300 s por defecto) en verse. No es un fallo de la
> publicación. El push corre desde fuera y no puede invalidar esa caché.

## Salvaguardas

- **Destino sin esquema**: si la base de Railway no tiene las migraciones
  aplicadas, el push falla antes de escribir nada y dice qué hacer (el
  `docker/entrypoint.sh` de la imagen corre `prisma migrate deploy` en cada
  despliegue).
- **Destino igual al origen**: si `PUSH_TARGET_DATABASE_URL` apunta a la misma
  base que `DATABASE_URL` —fácil de provocar copiando un `.env`— el push se
  niega a arrancar.
- **Fallo a mitad de camino**: el `SyncRun` de destino queda en `status='error'`
  con el mensaje. No hay transacción global a propósito: envolver ~27k filas en
  una sola transacción sobre un enlace público es peor remedio que la
  enfermedad, y como la operación es idempotente, **basta con volver a
  correrla** para que termine el trabajo.

## Alternativa descartada

Se evaluó exponer endpoints de escritura en la API y empujar por HTTPS con un
token. Se descartó para esta fase: la API todavía no tiene autenticación (ver
[infrastructure.md](./infrastructure.md)), habría que construirla solo para
esto, y el volumen (~27k productos en lotes HTTP) es bastante más lento que el
acceso directo. Si más adelante la base deja de ser alcanzable desde fuera, el
`CatalogPushService` ya aísla el destino detrás de un único cliente Prisma:
cambiar el transporte no toca la lógica de comparación.
