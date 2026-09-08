# Migración progresiva de contenido de producto y SEO

Este catálogo separa los datos maestros del ERP del contenido editorial. La
fuente DWH puede seguir sincronizándose mientras el equipo completa las fichas
por lotes.

## Campos y contrato

`products` tiene tres columnas editoriales opcionales:

| Campo Prisma | Columna | Uso |
| --- | --- | --- |
| `longDescription` | `long_description` | Texto largo visible en la ficha. Texto plano, con párrafos separados por una línea en blanco. |
| `seoTitle` | `seo_title` | Título de la página, idealmente entre 50 y 65 caracteres. |
| `seoDescription` | `seo_description` | Metadescripción y resumen para compartir, idealmente hasta 160 caracteres. |

El DWH conserva el nombre, el SKU y la descripción corta del ERP; no escribe
ninguno de estos tres campos. La API los devuelve en todos los listados,
destacados y detalles:

```json
{
  "descripcion": "68450362",
  "descripcionLarga": "La Mayonesa Fruco ...",
  "seo": {
    "title": "Mayonesa Fruco caja 18 kg | JDH",
    "description": "Mayonesa Fruco en caja de 18 kg ..."
  }
}
```

Los valores pendientes son `null`; la UI no debe fabricar texto comercial a
partir del código del ERP.

## Primer lote

El lote revisado está en
[`data/product-content/initial-with-images.json`](../data/product-content/initial-with-images.json).
Contiene 45 productos activos con imagen primaria: Fruco (23), Maizena (10),
Knorr (9) y Hellmann's (3). Cada registro se identifica por `productoKey` y
trae un `sourceChecksum` de la imagen usada como evidencia. El checksum impide
aplicar un texto si la imagen fue reemplazada después de la revisión.

El contenido se basa en el nombre, la presentación visible y el texto legible
del empaque. No afirma ingredientes, beneficios nutricionales, certificaciones,
disponibilidad, precios ni condiciones comerciales que no estén en la fuente.

## Flujo para cada lote

1. Generar un inventario actual:

   ```bash
   pnpm product-content:import -- --inventory --output=reports/product-content-inventory.json
   ```

   El inventario incluye `productoKey`, SKU, marca, URLs, posiciones y
   checksums de todas las imágenes.

2. Revisar la imagen primaria y, cuando aporte información, las imágenes de la
   galería. Confirmar nombre, tipo de producto y presentación; dejar pendiente
   cualquier dato ilegible o contradictorio.

3. Crear un JSON con `formatVersion: 1` y una lista `products`. Para cada
   registro incluir:

   ```json
   {
     "productoKey": "...",
     "longDescription": "Texto editorial de al menos 80 caracteres.",
     "seoTitle": "Producto y presentación | JDH",
     "seoDescription": "Resumen claro de hasta 160 caracteres.",
     "evidence": [{ "position": 0, "sourceChecksum": "sha256..." }]
   }
   ```

   Usar texto plano, una sola intención por frase, español de Colombia y
   términos que un comprador buscaría: marca, producto, presentación y uso
   general. No introducir promesas ni especificaciones no verificadas.

4. Ejecutar la validación sin escribir:

   ```bash
   pnpm product-content:import -- --file=data/product-content/lote.json
   ```

   La validación comprueba claves conocidas y únicas, longitudes, ausencia de
   HTML, evidencia vigente, producto activo e imagen primaria. Un error deja
   el lote completo sin cambios y aparece como pendiente en el reporte.

5. Aplicar solo cuando el reporte sea válido:

   ```bash
   pnpm product-content:import -- --file=data/product-content/lote.json --apply
   ```

   Cada producto se actualiza dentro de su propia transacción. Por defecto se
   rellenan únicamente campos vacíos; el contenido editorial existente queda
   intacto. El reporte distingue valores aplicados, valores conservados,
   pendientes y errores. La ejecución es repetible y limpia la caché HTTP si
   hubo cambios.

6. Para una corrección editorial explícitamente revisada, usar `--replace` junto
   con `--apply`. Revisar el diff del JSON antes de ejecutarlo:

   ```bash
   pnpm product-content:import -- --file=data/product-content/correccion.json --apply --replace
   ```

7. Publicar la base local en el destino después de validar una muestra:

   ```bash
   pnpm push:catalogo -- --limit=50
   pnpm push:catalogo
   ```

   El push incluye los tres campos editoriales en el hash y conserva en destino
   el mismo valor que está en local.

## Cómo incorporar productos que reciben imágenes después

Cuando una nueva ingesta crea una imagen primaria, volver a generar el
inventario. El nuevo checksum debe entrar en `evidence`; no reutilizar el de la
entrega anterior. Se puede migrar un lote mixto: los productos sin imagen o
inactivos quedarán reportados como error y los válidos se aplicarán solo si se
corrige el archivo y se vuelve a ejecutar la validación.

Para auditar una corrida, conservar el JSON de entrada, la salida del CLI y el
checksum de cada imagen. Un producto con texto existente se reporta como
`sin cambios`; no se sobrescribe salvo que se use `--replace` de forma
intencional.

## Integración SEO en la UI

En la página pública del producto:

- usar `seo.title` como `<title>` y como título Open Graph, con un fallback
  controlado al nombre solo mientras el SEO esté pendiente;
- usar `seo.description` como `<meta name="description">` y resumen Open Graph;
- renderizar `descripcionLarga` en el contenido visible, sanitizando solo si la
  UI permite formato enriquecido (la API entrega texto plano);
- usar la URL canónica de la ruta pública de la UI, no el SKU ni una URL de
  almacenamiento;
- usar la `imagenUrl` primaria y sus variantes para Open Graph y la galería.

La UI puede generar JSON-LD `Product` con `name`, `image`, `description`, `sku`
y `brand`. Solo añadir `offers`, precio, disponibilidad o reseñas cuando esos
datos estén publicados y sean verificables. Consultar las [directrices de
Google para Product snippets](https://developers.google.com/search/docs/appearance/structured-data/product-snippet)
y validar las páginas con Rich Results Test; la existencia de los campos SEO
por sí sola no garantiza un resultado enriquecido.

## Despliegue y recuperación

1. Aplicar la migración aditiva `20260908120000_product_content_seo` en local y
   destino antes de usar el nuevo contrato.
2. Desplegar la API compatible; los productos antiguos siguen respondiendo con
   `null`.
3. Ejecutar el importador local y luego `push:catalogo`.
4. Verificar una respuesta de listado y una de detalle, además de la cantidad
   de productos con `seoTitle` y `longDescription` no nulos.

La migración es reversible a nivel de contenido: conservar los JSON de entrada
y los informes de cada corrida para restaurar valores anteriores con una nueva
carga `--replace`. La eliminación de columnas requiere una migración posterior
y una revisión de consumidores.
