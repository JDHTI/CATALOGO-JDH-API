# Logos comerciales de marcas y proveedores

Los logos son un dato **editorial**: no vienen del datawarehouse y el sync de
productos nunca los toca. Se cargan aparte y quedan `null` hasta entonces.

## Modelo

Tanto `Brand` como `Supplier` tienen dos columnas:

| Campo           | Uso                                                        |
| --------------- | ---------------------------------------------------------- |
| `logoObjectKey` | Key del objeto en el bucket S3/MinIO. Uso interno.          |
| `logoUrl`       | URL absoluta servible. Es lo único que se expone en la API. |

`GET /brands` y `GET /suppliers` devuelven `logoUrl` (o `null`). El
`proveedor` embebido dentro de un producto **no** lo lleva.

Cuando no hay logo viaja `null`, nunca cadena vacía ni placeholder generado por
el backend: el respaldo visual (monograma con iniciales) lo pone la UI.

## Cargar un logo

```bash
pnpm logos:upload -- --tipo=marca     --nombre="CORONA"       --archivo=./corona.png
pnpm logos:upload -- --tipo=proveedor --nombre="ACO UNILEVER" --archivo=./aco.png
```

- `--nombre` debe ser el **nombre exacto del catálogo** (no distingue
  mayúsculas): el que devuelven `GET /brands` y `GET /suppliers`. Si no existe,
  el comando falla con un mensaje explícito en vez de crear la fila.
- Formatos admitidos: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`.
- La key se genera como `logos/marcas/<slug>.<ext>` o
  `logos/proveedores/<slug>.<ext>`. El slug solo afecta al nombre del archivo;
  el nombre que se muestra sigue siendo el crudo del DWH.
- Volver a ejecutarlo sobre la misma entidad **reemplaza** el logo.
- Tras la carga se invalida la caché HTTP, así que el nuevo `logoUrl` se sirve
  de inmediato en vez de esperar los 300 s de TTL.

No hay endpoint HTTP de subida **a propósito**: el catálogo es público y aún no
tiene capa de autenticación. Añadirlo sin auth permitiría a cualquiera
sobrescribir la imagen de marca del catálogo.

## Cómo deben venir los archivos

Requisitos verificados en navegador contra la UI del catálogo:

- **Recortados al contenido.** Se pintan con `object-contain` dentro de una
  caja cuadrada de 48–56 px, así que cualquier proporción sirve; lo que se ve
  mal es un logo con mucho margen en blanco incorporado, porque queda diminuto
  dentro de su hueco.
- **SVG minificado.** Los SVG no pasan por el optimizador de imágenes de la UI
  (Next los marca como `unoptimized` y el navegador los pide directos al
  bucket), así que viajan con su peso original: no hay recompresión que los
  rescate. Los formatos raster sí se optimizan.
- Fondo transparente cuando el formato lo permita.

Los cuatro formatos admitidos funcionan en la UI sin configuración adicional.

## Qué logos vale la pena pedir

El catálogo es de menaje, aseo y dotación. De los 9.042 productos activos, el
top 10 de marcas concentra ~3.200 (más de un tercio):

`CORONA` (1.198), `RUBBERMAID` (465), `ESTRA` (414), `TRAMONTINA` (225),
`FAMILIA` (204), `CRISTAR PELDAR` (197), `TASK PRO` (173), `COLOMBINA` (151),
`DIVERSEY` (146), `ADEREZOS` (121).

Los 645 proveedores, en cambio, son etiquetas de clasificación del ERP con
forma jurídica (`LOCERIA COLOMBIANA S.A.`): cubrirlos con logos no compensa,
y el monograma es un respaldo razonable para ellos.

> Ojo con emparejar logos por parecido de nombre: `CORONA` aquí es
> Organización Corona (menaje), no la cerveza. Un logo equivocado en esa marca
> afectaría al 13 % del catálogo.
