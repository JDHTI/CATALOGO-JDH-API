# Logos de marca (`brands/`)

Logos de marca en el bucket más un **manifiesto público** que el frontend lee
directo del CDN: cargar 20 logos nuevos no requiere desplegar la API ni el
frontend, solo correr el comando. Herramienta **solo local**, igual que
`images:ingest` y `site-images:upload`.

No se escribe nada en BD: **la marca es el nombre del archivo**. La tabla de
marcas solo se lee para enlazar cada logo con su marca del catálogo (campo
`marca`, ver abajo).

## Consumo desde el frontend

```
GET {S3_PUBLIC_URL}/brands/manifest.json
```

```json
{
  "version": 1,
  "generadoEn": "2026-10-01T17:20:00.000Z",
  "marcas": [
    {
      "slug": "alpina",
      "logo": "https://cdn.jdh.com.co/brands/alpina/logo-ab12cd34.webp",
      "marca": { "id": 12, "slug": "alpina", "nombre": "ALPINA" }
    },
    { "slug": "nescafe-dolcegusto", "logo": "https://cdn.jdh.com.co/brands/nescafe-dolcegusto/logo-0f1e2d3c.webp" }
  ]
}
```

- `marca` es **opcional**: viene solo si el slug del archivo coincide con un
  `Brand.slug` (docs/brands.md) de una marca con productos activos, el mismo
  criterio con el que `GET /brands/{slug}` responde 200. Sin `marca`, el
  logo no se enlaza a `/marcas/{slug}`. El campo se omite, nunca es `null`.
- El cruce se hace al generar el manifiesto: si una marca gana o pierde
  productos activos, se refleja en la siguiente corrida de `brands:ingest`
  (basta `--solo-manifiesto`).

- Es la **lista completa**: el frontend no debe tener logos fijos en el
  código. Lo que está en el manifiesto existe; lo que no, no.
- Orden por `slug`.
- Las URLs de logo son **inmutables** (llevan hash del contenido): se pueden
  cachear sin límite. El manifiesto es lo único con caché corta
  (`max-age=60`), así que un cambio se ve en ~1 minuto.
- `version` sube solo con cambios que rompan el formato.

**CORS**: `<img src>` no lo necesita, pero un `fetch()` del manifiesto desde
el navegador sí. En R2 hay que permitir `GET` desde el origen del frontend en
la política CORS del bucket. Si el frontend lo lee del lado del servidor (SSR
/ RSC), no hace falta.

## Cargar

```bash
pnpm brands:ingest -- --dir=./Logos --dry-run   # siempre primero
pnpm brands:ingest -- --dir=./Logos
pnpm brands:ingest -- --dir=./Logos --prune     # además borra del bucket lo que no está en la carpeta
pnpm brands:ingest -- --solo-manifiesto         # solo regenera el manifiesto
```

- Es **incremental**: el manifiesto se arma leyendo el bucket, no la carpeta.
  Correrlo con 3 logos no borra los otros 70 (salvo con `--prune`).
- `--dry-run` convierte todo (un archivo corrupto falla en el ensayo), pero no
  sube ni borra. Deja junto al CSV `reports/brands-manifest-{timestamp}.json`
  con el manifiesto tal como quedaría.
- Idempotente: el mismo archivo sale `omitido / checksum sin cambios`. Una
  imagen distinta para la misma marca sube la nueva y borra la anterior.
- `--prune` deja `brands/` **igual a la carpeta**: borra todo lo que no
  corresponda a un archivo de esta corrida. Usarlo solo con la carpeta
  completa.
- `--force` resube aunque el checksum no haya cambiado.
- Escribe `reports/brands-ingest-{timestamp}.csv`:
  `archivo, marca, estado, motivo, objectKey`, con `estado` `ok` | `omitido` |
  `error` | `eliminado` | `sin-marca`.
- `sin-marca`: logo del manifiesto (de todo el bucket, no solo de esta
  corrida) cuyo slug no coincide con ninguna marca del catálogo. No es error,
  pero la UI no lo enlaza: hay que renombrar el archivo y volver a cargarlo
  (con `--prune` para borrar el slug viejo). Si existe una marca que solo
  difiere en los guiones, el motivo la sugiere
  (`nescafe-dolcegusto` → `renombra el archivo a nescafe-dolce-gusto`).

## Cómo deben venir los archivos

```
Logos/
  alpina.png               → slug "alpina"
  agricola_himalaya.png    → slug "agricola-himalaya"
```

- Carpeta **plana**: un archivo por marca. Subcarpetas y archivos que no son
  imagen (un CSV, p. ej.) se ignoran.
- El nombre se normaliza a slug (minúsculas, sin acentos, `_` y espacios →
  `-`). Renombrar el archivo es cambiar de marca: el slug viejo queda en el
  bucket hasta correr con `--prune`.
- Dos archivos que den el mismo slug (`alpina.png` y `Alpina.jpg`) son error.
- Formatos: PNG, JPG/JPEG, WebP, GIF, TIF/TIFF, AVIF. Todo se reencoda a WebP
  sin redimensionar y conservando la transparencia. Deben venir **recortados
  al contenido** (ver docs/logos.md).

## Layout del bucket

```
brands/manifest.json
brands/{slug}/logo-{hash8}.webp
```

Una carpeta por marca para poder sumarle media más adelante (banners, etc.)
sin mover los logos.

Convive con `logos/` (`logos:upload`), que es otra cosa: asigna un logo a una
fila de `Brand`/`Supplier` en BD para `GET /brands` y `GET /suppliers`.
