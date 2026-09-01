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

## Layout del bucket

```
site/hero/{slug}.webp
site/banners/{slug}.webp
```

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
