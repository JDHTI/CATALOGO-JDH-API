# Marcas: slug y endpoints

## `Brand.slug`

Identificador público y estable de la marca para URLs (`/marcas/{slug}`) y
para cruzar los logos de `brands/manifest.json` con el catálogo.

- Se calcula con `LogosService.slug(nombre)`, la misma normalización de
  `logos:upload` y `brands:ingest`: sin acentos, minúsculas, todo lo que no
  sea `[a-z0-9]` pasa a `-`, sin guiones en los bordes
  (`NESCAFE DOLCE GUSTO` → `nescafe-dolce-gusto`, `HERSHEY´S` → `hershey-s`).
  Un nombre sin letras ni dígitos queda en `marca`.
- **Colisión** (dos nombres con el mismo slug, p. ej. `ACME` y `Acme.`): la
  marca que ya tenía el slug base lo conserva y la otra recibe
  `{base}-{id}` (`acme-57`). Si justo ese también está tomado, se agrega un
  contador (`acme-57-2`). No hay error ni intervención manual.
- **Estable**: un slug asignado no cambia mientras no cambie el nombre de su
  marca. La política está en `src/modules/brands/brand-slug.ts`.

### Quién lo mantiene

- **Migración** `20261019120000_brand_slug`: agrega la columna y hace el
  backfill en SQL (colisión: la de menor id se queda la base).
- **Sync del DWH**: una marca nueva se crea con su slug. Al empezar cada
  corrida, el sync revisa todas las marcas y corrige las que tengan un slug
  que ya no corresponde a su nombre (renombre manual en BD, backfill SQL que
  no coincidió con la normalización JS, o una creación interrumpida). Lo que
  corrige queda en el log como warning.
- En el DWH una marca se identifica por su nombre: si cambia de nombre allá,
  llega como marca nueva (slug nuevo) y la vieja se queda sin productos
  activos, así que su `/brands/{slug}` pasa a 404.
- **Push del catálogo**: copia el slug tal cual; el destino no lo recalcula.

## Endpoints

`GET /api/v1/brands` (marcas con productos activos, orden por nombre):

```json
[{ "id": 12, "slug": "alpina", "nombre": "ALPINA", "totalProductos": 34, "logoUrl": null }]
```

`GET /api/v1/brands/{slug}`: misma forma que un ítem de la lista. Da `404` si
el slug no existe, si la marca no tiene productos activos o si el slug está
mal formado. Para listar sus productos se sigue usando
`GET /api/v1/products?brandIds={id}`.
