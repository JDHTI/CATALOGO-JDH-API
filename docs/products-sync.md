# Sincronización de productos (DWH → catálogo)

## Fuente elegida y por qué

La fuente es la vista **`consumo.productos`** del datawarehouse Postgres
(conexión opcional vía `DatawarehouseService`, variables `DWH_*`).

- El acceso directo al mart fue **denegado**; `consumo` es la capa expuesta
  para consumo externo.
- En el SQL el schema se **califica siempre** (`consumo.productos`), sin
  depender de `DWH_SCHEMA`.
- `fecha_actualizacion` viene **siempre NULL** en esta vista y no hay CDC, así
  que no existe forma fiable de detectar deltas en el origen. La estrategia es
  **full-extract + upsert idempotente**: ~27.476 filas (9.042 activas) es un
  volumen trivial para recorrerlo completo en lotes de 1.000.
- Filtro obligatorio de extracción: `WHERE sku IS NOT NULL` (excluye las dos
  filas centinela `'(desconocido)'` / `'(no aplica)'`).
- Se importan productos **activos e inactivos** (`estado` → boolean `active`);
  los endpoints públicos filtran por activos.
- El DWH **no tiene precios**: los campos de precio del catálogo son nullable
  y el sync no los toca.
- El DWH se refresca de forma manual cada varios días, por lo que un cron
  diario es más que suficiente.

## Mapeo columna → campo

| `consumo.productos`   | `Product` (tabla `products`)       | Notas                                                    |
| --------------------- | ---------------------------------- | -------------------------------------------------------- |
| `producto_key`        | `productoKey`                      | Hash surrogate estable del DWH. **Clave del upsert**.     |
| `sku`                 | `sku`                              | Indexado, **no único** (se repite entre compañías).       |
| `descripcion`         | `name`                             | Nombre comercial (fallback: el sku). Se recortan los símbolos iniciales del ERP (`*Vaso 7oz` → `Vaso 7oz`); el resto se conserva intacto porque lleva unidades y códigos. |
| `sku_proveedor`       | `shortDescription`                 | Texto/código operativo del ERP; en el lote actual suele ser numérico y **no es contenido editorial ni un código de proveedor**. |
| `fecha_creacion`      | `dwhCreatedAt`                     |                                                           |
| `fecha_actualizacion` | — (no se usa)                      | Siempre NULL en la vista.                                 |
| `estado` (`'A'/'I'`)  | `active`                           | `'A'` → `true`.                                           |
| `tipo_item`           | `tipoItem`                         | Crudo del DWH.                                            |
| `cod_proveedor`       | `Supplier.code` → `supplierId`     | Ver semántica de "proveedor" abajo.                       |
| `proveedor`           | `Supplier.name`                    |                                                           |
| `fabricante`          | `Manufacturer.name` → `manufacturerId` | Trim; vacío → `null`.                                 |
| `marca`               | `Brand.name` → `brandId`           | Trim; vacío → `null`.                                     |
| `categoria`/`subcategoria` | — (no se leen)                | La categorización vive aparte (`product_categorizations`); ver [categorization.md](categorization.md). El sync la dispara al terminar. |
| `linea`/`sublinea`/`grupo`/`origen` | mismos nombres      | Crudos del DWH, para trazabilidad.                        |
| `peso`                | `pesoKg`                           | Decimal(12,3).                                            |
| `factor_empaque`      | `factorEmpaque`                    | Decimal(12,3).                                            |

Campos propios del sync: `sourceHash` (sha1 de los campos mapeados; si no
cambió, la fila no se reescribe y cuenta como `unchanged`) y `syncedAt`
(marca de "visto en esta ejecución").

Los campos editoriales `longDescription`, `seoTitle` y `seoDescription` quedan
fuera del mapeo y del hash del DWH. Un sync puede actualizar el resto de la fila
sin borrar contenido editorial; los textos se cargan por lotes con el flujo de
[`product-content-migration.md`](./product-content-migration.md).

## Propiedad de los campos y protección

La frontera de escritura del sync es explícita. El DWH puede actualizar los
campos del mapeo anterior, además de `active`, `sourceHash` y `syncedAt`. El
catálogo conserva los campos que se gestionan fuera del DWH:

| Campo propio del catálogo | Cómo se actualiza |
| ------------------------- | ----------------- |
| `ProductImage` e imágenes | `images:ingest`; el sync de productos no toca filas ni referencias de imagen. |
| `longDescription`, `seoTitle`, `seoDescription` | `product-content:import`; una sincronización DWH nunca los incluye en el update. |
| `price`, `priceCurrency`, `priceUpdatedAt` | Flujo de precios futuro; actualmente el DWH no los provee. |
| `categoryId`, `subcategoryId` | Columnas heredadas sin uso: la categoría vive en `product_categorizations` (ver [categorization.md](categorization.md)). |
| `Supplier.logo*`, `Brand.logo*` | Gestión de logos; el upsert del DWH solo actualiza el nombre de la clasificación. |

Para una fila existente, el servicio proyecta de forma explícita el conjunto de
campos DWH antes de ejecutar el `update`. No reutiliza el objeto completo de una
fila ni hace un `upsert` que pueda poner a `null` campos propios. Si un producto
deja de aparecer en la extracción se marca `active=false`; nunca se borra la
fila, por lo que sus imágenes, contenido editorial, precios y categorización se
conservan si el producto vuelve a aparecer.

El `push:catalogo` es una operación separada y publica el estado completo del
catálogo local, incluidos los campos propios. Por eso el orden operativo es:

1. sincronizar el DWH en la base local;
2. ejecutar las cargas de imágenes, contenido o precios;
3. revisar los contadores y una muestra;
4. ejecutar `push:catalogo` para replicar ese estado al destino.

## Semántica de "proveedor"

`cod_proveedor`/`proveedor` es una **clasificación comercial/de mercadeo** del
ERP (criterio mayor t106), **no una identidad jurídica**: no hay NIT ni datos
fiscales. Son ~645 valores distintos y para el catálogo **es** el criterio de
agrupación por proveedor. Las filas sin clasificación caen en el proveedor de
respaldo `SIN_CLASIFICAR`.

## Cómo funciona una ejecución

1. Se crea un `SyncRun` (`type='products'`, `status='running'`).
2. Se recorre la extracción en lotes de 1.000 (`ORDER BY producto_key`, que
   estabiliza la paginación LIMIT/OFFSET del stream). Por lote:
   - upsert de `Supplier`/`Brand`/`Manufacturer` distintos (trim, vacíos
     ignorados; una sola vez por valor y ejecución),
   - upsert de `Product` por `productoKey` con detección de cambios por
     `sourceHash` (inserta / actualiza / salta).
3. Al final, todo producto activo cuyo `syncedAt` sea anterior a la ejecución
   (no vino en la extracción) se **desactiva** (`active=false`): soft-delete,
   nunca se borra.
4. El `SyncRun` queda con contadores (`totalRead`, `inserted`, `updated`,
   `deactivated`, `unchanged`) o con `status='error'` y el mensaje.
5. Si hubo cambios se invalida la caché HTTP (`invalidateByPrefix('http:')`).

La **carga inicial es el mismo flujo**: el primer run inserta todo.

## Cómo correrlo

- **Manual / carga inicial** (requiere las `DWH_*` del `.env` diligenciadas):

  ```bash
  pnpm sync:products
  ```

  Arranca un contexto standalone de Nest, ejecuta un sync completo y termina
  (exit code 1 si falla). No existe endpoint HTTP de sync (no hay auth aún).

- **Programado**: cron `SYNC_PRODUCTS_CRON` (default `0 2 * * *`, 02:00 diario)
  con `@nestjs/schedule`. Se apaga con `SYNC_PRODUCTS_ENABLED=false`. Si el DWH
  está deshabilitado (sin `DWH_HOST`) el cron no hace nada y queda un warn en
  el log.

## Mejora futura pactada

Pedir al equipo del DWH que `consumo.productos` exponga dos columnas que hoy
solo existen en `core.producto`:

- **`codigo_barras_principal`** — para mostrar/buscar por código de barras en
  el catálogo.
- **`dw_extracted_at`** — para habilitar un **watermark real** (extracción
  incremental por fecha de carga en el DWH) en lugar del full-extract actual.
