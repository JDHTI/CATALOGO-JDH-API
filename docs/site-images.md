# Imágenes generales del sitio

Hero, banners y piezas visuales que no pertenecen a un producto ni a un
proveedor. No hay modelo en BD: el frontend arma la URL por convención
(`S3_PUBLIC_URL` + key), sin pasar por la API. Herramienta **solo local**,
igual que `logos:upload` e `images:ingest`.

## Cargar una imagen

```bash
pnpm site-images:upload -- --categoria=hero --slug=home-desktop --archivo=./home-desktop.png
pnpm site-images:upload -- --categoria=banners --slug=home-top-mobile --archivo=./banner1-mobile.jpg
```

- `--categoria` es `hero` o `banners` (prefijo fijo del bucket).
- `--slug` nombra el **placement**, no la campaña (`home-desktop`, no
  `blackfriday-2026`): así la URL nunca cambia cuando cambia el creativo,
  solo se sobrescribe el archivo. Se normaliza igual que los logos (sin
  acentos/símbolos, minúsculas, guiones).
- La imagen se reencoda siempre a WebP, preservando dimensiones y
  transparencia — no genera variantes ni fuerza un lienzo cuadrado como
  `images:ingest`, porque son piezas ya diseñadas al tamaño final.
- Formatos de entrada: PNG, JPG/JPEG, WebP, GIF, TIFF, AVIF.
- Volver a correrlo con la misma `categoria`+`slug` **reemplaza** el archivo.

## Cargar una carpeta completa

```bash
pnpm site-images:upload -- --categoria=banners --dir=./entradas/site/banners
```

Sube cada imagen admitida que encuentre directamente dentro de `--dir` (no
recursivo). El `slug` de cada una sale de su propio nombre de archivo (sin
extensión, normalizado igual que `--slug`), así que **renombrar el archivo
antes de subirlo** es la forma de fijar el placement final. Volver a correr
el comando con archivos del mismo nombre reemplaza esas imágenes; un archivo
nuevo se agrega sin tocar los demás. Al final se muestra un resumen
(nuevas/reemplazadas/fallidas) y el comando falla (exit code 1) si alguna
carga individual falló, aunque el resto sí se haya subido.

## Layout del bucket

```
site/hero/{slug}.webp
site/banners/{slug}.webp
```

### Convención de `banners`: slug = slug de categoría

Para que el frontend pueda resolver el banner de una categoría sin mantener
un mapeo aparte, el `slug` de cada banner **es el mismo `slug` de la
categoría** (ver `GET /api/v1/categories`), por ejemplo
`site/banners/mascotas.webp` para la categoría `mascotas`. Así el frontend
arma la key en base a la categoría activa y la pide directamente.

Caso especial: `site/banners/general.webp` es el banner por defecto (no
está atado a ninguna categoría) — se usa fuera de una categoría específica,
p. ej. en el home o el catálogo completo.

## Caché

`Cache-Control: public, max-age=300` (5 min) — a diferencia de `products/`,
la key es estable (no lleva hash del contenido), así que un `max-age`
inmutable haría que un reemplazo tarde hasta un año en reflejarse. Si más
adelante hace falta invalidar de inmediato, purgar caché en Cloudflare para
esa key.

## Por qué solo local

Igual que `images:ingest`: `sharp` es una `devDependency` y no existe en el
contenedor de producción de la API, así que este comando no puede correr ahí
ni por accidente. La carga es trabajo del operador, desde su máquina.
