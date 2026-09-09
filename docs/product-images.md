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

### Clasificación: principal y galería, nada más

Solo hay dos roles, y salen de la **posición**:

| Posición | Rol | De dónde viene |
| -------- | --- | -------------- |
| `0` | **Imagen principal** (`isPrimary`) | el archivo sin letra: `15-5798-….png` |
| `1`, `2`, `3`, … | **Galería** | las letras: `15B-`, `15C-`, `15D-` |

Deliberadamente NO se distingue «detalle» de «tabla nutricional». Se evaluó y
se descartó: **la letra no mapea a un tipo estable**. En la referencia 5798 la
`B` es otro ángulo del producto, la `C` los ingredientes y la `D` la tabla
nutricional; en la 12935 la `B` ya es la tabla nutricional y la `D` los
ingredientes. Clasificar más fino exigiría que alguien reparta los archivos a
mano en cada entrega, y el catálogo no gana nada con eso: a la UI le basta
saber cuál es la portada y cuáles van en el carrusel.

Si algún día hace falta, el lugar correcto es que el proveedor lo declare en
la entrega, no que lo adivine el pipeline.

Las URLs se guardan absolutas y servibles en `product_images`: la API nunca
consulta el bucket al leer, no hay presigned URLs ni revalidación. Como la key
incluye el hash del contenido, si la imagen cambia cambia la URL — el cliente
puede cachear indefinidamente sin purgar nada.

`alt` NO lo puebla la ingesta: queda `null` siempre. Es un campo editorial,
reservado para cuando haya de dónde sacar un texto por imagen; hasta entonces
el alt lo genera la UI.

### Ordenamiento y destacados

- `GET /products?orderBy=conImagen` pone delante los productos con imagen
  primaria. Es **opt-in**: el orden por defecto sigue siendo alfabético,
  porque hay consumidores (las sugerencias del buscador) donde colar un
  producto con foto por encima de una coincidencia de nombre más cercana no
  es una mejora.
- `GET /products/destacados?limit=8` es la vitrina de la home: solo productos
  con imagen primaria, repartidos entre marcas y rotados con semilla diaria.
  Ver `ProductsRepository.findFeatured`.

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
  `archivo, carpeta, proveedor, sku, tipo, posicion, estado, motivo,
  productIds, objectKeyBase` (`carpeta` es la que contiene el archivo,
  `archivo` la ruta relativa completa, y `tipo` es `principal` o `galeria`
  según la posición — sirve para verificar de un vistazo qué archivo quedó
  como portada antes de la carga real).
  `estado` es `ok` | `omitido` | `error`. Revisar los `error` es el paso
  operativo después de cada corrida.

## Cómo deben venir los archivos

Hay cuatro layouts admitidos. Se detectan solos por el nombre de la carpeta que
contiene cada imagen; el recorrido es recursivo, así que las carpetas
intermedias (una por marca, p. ej.) no molestan.

**Cuando la imagen está en una subcarpeta, la referencia la manda la carpeta.**
El nombre del archivo solo decide en el layout D, donde las imágenes cuelgan
directo de la carpeta del proveedor y no hay carpeta de producto que leer. Los
proveedores nombran los archivos como quieren, así que no son fuente confiable
de la referencia.

### Layout A — carpeta por producto con consecutivo

```
399/                                        ← código de proveedor (o --proveedor=399)
  1.FRUCO 2000X2000 PX/                     ← carpeta de marca: se ignora
    1-1001-FRUCO TOMATE 4350 G/             ← consecutivo-REFERENCIA-nombre
      1-1001-FRUCO TOMATE 4350 G.png        ← principal   → posición 0
      1B-1001-FRUCO TOMATE 4350 G.png       ← galería     → posición 1
      1C-1001-FRUCO TOMATE 4350 G.png       ← galería     → posición 2
```

- **La referencia la manda la carpeta**, no el archivo: es el segmento del
  medio (`1001`) y debe ser el `Product.sku` del ERP.
- El **consecutivo** (`1`, `40`…) es numeración interna del proveedor y se
  **descarta**: no llega al bucket ni a la base de datos.
- La **letra del consecutivo** define la posición en la galería: sin letra (o
  `A`) es la principal, `B` la segunda, `C` la tercera, y así.
- En el bucket la carpeta del producto es **`{referencia}-{nombre}`** en slug
  (`1001-fruco-tomate-4350-g`), o sea el nombre de la carpeta de origen sin
  el consecutivo y normalizado.

### Layout B — igual que A pero con la referencia primero

```
1001-1-FRUCO TOMATE 4350 G/                 ← REFERENCIA-consecutivo-nombre
  1001-1B-FRUCO TOMATE 4350 G.png           ← galería     → posición 1
0212-01/                                    ← el nombre del producto es opcional
  0212-01.png                               ← principal   → posición 0
  0212-01B.png                              ← galería     → posición 1
```

`1-1001-NOMBRE` (layout A) y `1001-1-NOMBRE` (layout B) tienen exactamente la
misma forma, así que no se elige uno: se prueban **las dos lecturas** contra la
base y gana la que exista, empezando por la referencia más larga. Un
consecutivo es un contador corto; una referencia es un código del ERP.

### Layout C — carpeta = referencia, posición por orden ⚠️ temporal

```
1098/                                       ← código de proveedor (o --proveedor=1098)
  18929/                                    ← la carpeta ES la referencia
    30180284_S04.jpg                        ← principal   → posición 0
    30180284_S06.jpg                        ← galería     → posición 1
    30180284_S07.jpg                        ← galería     → posición 2
```

Para entregas donde los nombres de archivo no dicen nada de la posición
(`Hero_Image_30243107_ESP-06.png`, `30180284_S04.jpg`): sus sufijos son
numeración del proveedor, no posiciones. Acá **el nombre del archivo se ignora
por completo** y lo único que ordena la galería es la posición del archivo
dentro de la carpeta, en orden natural de nombre (`S2` antes que `S10`).

> **Es un parche temporal.** El orden alfabético no sabe cuál foto es el
> empaque y cuál un detalle: si la primera alfabéticamente es la equivocada, la
> principal queda mal y hay que renombrar el archivo antes de ingestar. Mientras
> no haya una clasificación real de las imágenes, esta variante deja el catálogo
> con fotos y en un orden razonable; sirve para publicar, no para dar la
> clasificación por buena.

En el bucket la carpeta del producto es la referencia pelada (`1098/18929/…`).

### Layout D — plano (`SKU.png`)

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
### Común a todos

- **Formatos de entrada**: PNG, JPG/JPEG, WebP, GIF, TIF/TIFF, AVIF.
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
products/{supplierCode}/{carpeta}/{hash8}/thumb.webp
products/{supplierCode}/{carpeta}/{hash8}/card.webp
products/{supplierCode}/{carpeta}/{hash8}/full.webp
```

Solo se suben las tres variantes. El archivo original se procesa en memoria y
no se conserva en el bucket: si hay que regenerar variantes, se vuelve a correr
`images:ingest` sobre la entrega del proveedor.

`{carpeta}` es `{referencia}-{nombre}` en los layouts A y B cuando la entrega
trae nombre (`399/1001-fruco-tomate-4350-g/…`), y la referencia pelada cuando
no lo trae o en los layouts C y D (`1098/18929/…`).

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
