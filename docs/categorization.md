# Categorización de productos

Los productos se organizan en **categoría → subcategoría → grupo**. La taxonomía
(13 categorías, 63 subcategorías, 238 grupos) sale de la propuesta de
categorización v3, revisada producto por producto. La UI pública usa categoría y
subcategoría; el grupo es el nivel fino al que apuntan las reglas de
clasificación.

## Por qué es independiente del sync

La base de productos cambia todo el tiempo: el sync del DWH crea productos,
cambia su clasificación en el ERP y los activa o desactiva. Por eso la
categorización **no vive en `products`**:

| | `products` | `product_categorizations` |
| --- | --- | --- |
| Quién la escribe | `pnpm sync:products` (cron o manual) | Categorización (`reconcile`, `assign`) |
| Clave de unión | `producto_key` (hash estable del DWH) | `producto_key` |
| Qué pasa si el producto se desactiva | `active=false`, la fila se conserva | La asignación se conserva |
| Qué pasa si el producto se reactiva | `active=true` | Ya está categorizado |

El sync **nunca** lee ni escribe la categorización, y la categorización nunca
modifica `products`. Se encadenan en un solo sentido: al terminar un sync
exitoso se ejecuta `reconcile()`; si este falla, el sync ya quedó completo y el
error solo se registra.

> `products.category_id` y `products.subcategory_id` son columnas heredadas que
> ya no se usan (la API lee la categoría de `product_categorizations`). Se
> conservan para no borrar columnas en la misma migración; se pueden retirar
> después.

## Modelo

- `categories` — nombre, `slug` (URL), `sort_order`, `active`. `active=false` la
  oculta de la navegación pública sin perder las asignaciones (hoy: *Servicios* y
  *Otros*).
- `subcategories` — igual, única por nombre y por slug dentro de su categoría.
- `product_groups` — tercer nivel.
- `product_categorizations` — **una fila por producto clasificado**:
  `producto_key`, `category_id`, `subcategory_id`, `group_id` (la jerarquía se
  repite a propósito: es la columna de filtrado), y
  - `source`: `propuesta` (carga inicial revisada) · `regla` (automática) · `manual`.
  - `confidence`: `alta` · `media` · `baja`.
  - `locked`: las asignaciones manuales quedan bloqueadas; ningún proceso
    automático las toca.
  - `needs_review`: pendiente de revisión humana.
  - `signature`: huella de la clasificación cruda del ERP (línea, sublínea,
    grupo, tipo de ítem) con la que se decidió.
- `categorization_rules` — reglas aprendidas (solo locales; no viajan al push).

**Sin fila = pendiente.** Un producto que ninguna regla ubica no recibe una
categoría inventada: sigue apareciendo en el listado sin filtros, pero no en
ningún filtro de categoría, y sale en `categorization review`.

## Qué pasa cuando cambia el catálogo

| Evento | Resultado |
| --- | --- |
| Producto **nuevo** | `reconcile` lo clasifica con las reglas (`source=regla`). Confianza `alta` → visible y sin revisión; `media` → visible y marcado `needs_review`; sin regla → pendiente. |
| El ERP **mueve** el producto de línea/sublínea/grupo | Cambia la `signature`. Si es automática se reevalúa: cambia de grupo si las reglas lo resuelven; si no, **conserva** el grupo y se marca `needs_review`. |
| Cambia solo el **nombre** | No reclasifica (el nombre no entra en la `signature`). |
| Producto **desactivado** / **reactivado** | La asignación no se toca. Los conteos públicos solo cuentan activos. |
| Asignación **manual** | Bloqueada: no cambia ni aunque el ERP mueva el producto. |
| Taxonomía editada a mano (renombrar, reordenar, ocultar) | `seed` solo **crea** lo que falta; nunca revierte esos ajustes. |

## Clasificador

Funciones puras en `categorization.classifier.ts`. Reglas aprendidas de las
asignaciones revisadas (`propuesta` y `manual`, sin confianza baja; nunca de sus
propias asignaciones), con cuatro tipos de clave de más a menos específica:

1. `lsg_w` — línea | sublínea | grupo ERP | primera palabra del nombre
2. `lsg` — línea | sublínea | grupo ERP
3. `g_w` — grupo ERP | primera palabra del nombre
4. `w` — primera palabra del nombre

Gana el primer tipo que acierta. `lsg` resuelve casi todo; `lsg_w` existe para los
grupos ERP heterogéneos (p. ej. «RECIPIENTES», donde conviven cajas, tapas y
canecas). Los ítems tipo *Servicio* van siempre al grupo *Servicios*.

**Calidad medida** (retención 80/20 sobre las asignaciones revisadas, 5.558
productos de prueba): 86,5 % de cobertura; de lo que clasifica acierta el grupo
exacto en **98,6 %**. Con confianza `alta` acierta 99,4 %, con `media` 94,7 %;
sobre productos activos la cobertura sube a 95 % (acierto 99,4 %). Lo que no
cubre queda pendiente.

## Operación

```powershell
pnpm categorization bootstrap      # carga inicial: seed + import + learn + reconcile
pnpm categorization reconcile      # clasifica lo nuevo / reevalúa lo movido
pnpm categorization learn          # reaprende reglas (tras muchas correcciones manuales)
pnpm categorization review --active --out pendientes.csv   # pendientes (o --kind review)
pnpm categorization assign --group <id> <productoKey> ...  # asignación manual, bloqueada
```

`seed`, `import` y `reconcile` son idempotentes. `import` solo crea asignaciones
para productos que aún no tienen una. Los archivos de la carga inicial están en
`data/categorizacion/` (`taxonomia.json`, `asignaciones-v3.csv`).

Flujo habitual: `pnpm sync:products` ya categoriza al terminar. Revisar de vez en
cuando `review` (pendientes y `needs_review`) y corregir con `assign`.

## API pública (para la UI)

- `GET /categories` — árbol de categorías visibles con sus subcategorías y el
  conteo de productos **activos**. Solo entra lo que tiene al menos un activo.
  `supplierIds`/`brandIds` (CSV) acotan los conteos a lo ya elegido en el panel.
- `GET /categories/:slug` — una categoría con sus subcategorías; 404 si no
  existe, está oculta o no tiene productos activos.
- `GET /products` acepta `categoryIds`, `subcategoryIds` (CSV; OR dentro del
  grupo, AND entre grupos y con proveedor/marca/búsqueda) y los singulares
  `categoryId`, `subcategoryId`.
- `Producto.categoria` y `Producto.subcategoria` pasan a `{ id, nombre, slug }`
  (antes `{ id, nombre }`, siempre `null`): cambio aditivo.

Respuestas con `HttpCacheInterceptor` (300 s). Tanto el sync como `reconcile` y
`assign` invalidan la caché `http:` cuando algo cambia.

## Publicación a Railway

`pnpm push:catalogo` ahora también lleva `categories`, `subcategories`,
`product_groups` y `product_categorizations` (por clave natural, nunca por id).
Las asignaciones se comparan campo a campo: una reclasificación local llega a
destino aunque el producto no haya cambiado. **Despliega la API antes de
publicar**: el destino necesita la migración `20261028120000_product_categorization`
(el push lo comprueba y avisa).

## Limitaciones conocidas

- La *categoría actual* del DWH (ALIMENTOS, ASEO…) no se guarda en `products`, así
  que las reglas usan línea/sublínea/grupo + nombre. Funciona (ver calidad), pero
  guardarla en el sync mejoraría la cobertura.
- Los ítems tipo *Servicio* siguen en el maestro de productos (160 hoy);
  conviene evaluar si deben salir.
- Reaprender (`learn`) reemplaza todas las reglas; si se hacen muchas
  correcciones manuales, vale la pena correrlo para que se propaguen.
