# Imágenes de producto

Pipeline de conversión a WebP y carga al bucket para las fotos que entregan
los proveedores. Es una herramienta **solo local**: no hay endpoint HTTP ni
corre dentro del contenedor de producción (ver «Por qué solo local» al final).

## Modelo

`ProductImage` guarda tres variantes por imagen, todas WebP sobre lienzo
cuadrado con fondo blanco:

| Variante | Lado    | Uso                              |
| -------- | ------- | --------------------------------- |
| `thumb`  | 200 px  | Miniaturas (buscador)              |
| `card`   | 600 px  | Grid del catálogo (listado)        |
| `full`   | 1600 px | Detalle del producto               |

`GET /products` y `GET /products/:id` exponen `imagenUrl` (la `card` de la
imagen primaria, por compatibilidad con el contrato ya confirmado con la UI)
y `imagenes[]` (galería completa, primaria primero).

## Cargar imágenes

```bash
pnpm images:ingest -- --dir=./entradas
pnpm images:ingest -- --dir=./entradas/ACO-UNILEVER --proveedor=P0123
pnpm images:ingest -- --dir=./entradas --dry-run --force --concurrencia=4
```

- `--dir` es la carpeta raíz: cada subcarpeta de primer nivel se trata como un
  proveedor distinto. Con `--proveedor=<código>` en cambio, `--dir` completo se
  trata como la carpeta de ESE proveedor (útil para cargar uno solo).
- `--dry-run` procesa y matchea todo pero no sube nada ni escribe en BD — usarlo
  siempre antes de una carga real para revisar el CSV.
- `--force` reprocesa aunque el checksum no haya cambiado (por defecto se
  salta: ver idempotencia más abajo).
- Escribe `reports/images-ingest-{timestamp}.csv` con una fila por archivo:
  `archivo, carpeta, proveedor, sku, estado, motivo, productIds, objectKeyBase`.
  `estado` es `ok` | `omitido` | `error`. Revisar los `error` es el paso
  operativo después de cada corrida.

## Cómo deben venir los archivos

- **Carpeta = proveedor.** El nombre de la carpeta debe ser el **código** del
  proveedor en el ERP (`Supplier.code`, el mismo que usa el sync de
  productos). Si no matchea por código, el sistema intenta el nombre exacto
  (sin distinguir mayúsculas) y luego un slug tolerante a acentos/puntuación —
  pero el código es lo único garantizado.
- **Nombre de archivo = SKU.** `123456.png` para la imagen principal.
  El formato exacto de entrega de los proveedores no está estandarizado, así
  que el parser es tolerante:
  - `123456.png` → SKU `123456`, posición 0 (primaria).
  - `123456-2.png` / `123456_2.png` → si `123456` no matchea solo, se
    reintenta como SKU `123456` en posición **2** (para una galería de varias
    fotos del mismo producto).
  - Sufijos de copia de Windows (`(1)`, `- copia`) se ignoran.
  - Un SKU que termina en dígitos por sí mismo (`REF-2024`) nunca se rompe: el
    sufijo de galería solo se prueba si el nombre completo no encontró
    producto.
- **Formatos de entrada**: PNG, JPG/JPEG, WebP, GIF, TIFF, AVIF.
- Fondos transparentes se aplanan a blanco automáticamente; no hace falta
  preprocesar nada, solo recortar al contenido.

Un archivo que no matchea ningún producto queda en el CSV con `estado=error` y
el motivo — no rompe la corrida de los demás.

## Idempotencia

Cada imagen se identifica por el SHA-256 de su contenido original
(`sourceChecksum`). Si se vuelve a correr `images:ingest` sobre la misma
carpeta sin cambios, todo sale `omitido / checksum sin cambios`: no hay
reprocesamiento ni sobrescritura en el bucket. Reemplazar una foto es tan
simple como sobrescribir el archivo de origen y volver a correr el comando.

## Layout del bucket

```
originals/products/{supplierCode}/{sku}/{hash8}.{ext}   ← archivo original
products/{supplierCode}/{sku}/{hash8}/thumb.webp
products/{supplierCode}/{sku}/{hash8}/card.webp
products/{supplierCode}/{sku}/{hash8}/full.webp
```

`hash8` son los primeros 8 caracteres del checksum. Si la imagen cambia,
cambia la key completa → `Cache-Control: public, max-age=31536000, immutable`
sin necesidad de purgar ningún CDN. El original se conserva para poder
regenerar variantes (p. ej. añadir AVIF más adelante) sin volver a pedir
archivos al proveedor.

## Dev (MinIO) vs. producción (Cloudflare R2)

`StorageService` es S3-compatible y no cambia entre entornos — solo el
`.env`. Ver el bloque comentado de R2 en `.env.example`. En R2: bucket
privado + **Custom Domain** público para servir por CDN; el token de
escritura solo lo usa este CLI, nunca la API en runtime.

## Por qué solo local

`sharp` (la librería de procesamiento) es una `devDependency`: el
[`Dockerfile`](../Dockerfile) de producción se construye con dependencias de
producción únicamente, así que el binario nativo **no existe** en el
contenedor que corre en producción — `images:ingest` no puede ejecutarse ahí
ni por accidente. La carga de imágenes es trabajo del operador, desde su
máquina, contra el bucket que corresponda.
