# Listas de pedido

Las listas son borradores privados del usuario autenticado. El API no emite
tokens: identifica al dueño con el claim `sub` que deja `JwtAuthGuard`, sin
consultar la base de autenticación de la UI.

## Endpoints

Todos viven bajo `/api/v1/order-lists` y requieren `Authorization: Bearer`.

| Método   | Ruta                                      | Respuesta                             |
| -------- | ----------------------------------------- | ------------------------------------- |
| `GET`    | `/order-lists`                            | `{ data, meta: { total, maxLists } }` |
| `POST`   | `/order-lists`                            | Lista creada (`201`)                  |
| `GET`    | `/order-lists/:listId`                    | Lista del usuario                     |
| `PATCH`  | `/order-lists/:listId`                    | Lista renombrada                      |
| `DELETE` | `/order-lists/:listId`                    | Sin contenido (`204`)                 |
| `GET`    | `/order-lists/:listId/items?page=&limit=` | Página `{ data, meta }`               |
| `PUT`    | `/order-lists/:listId/items/:productId`   | Línea con cantidad final              |
| `DELETE` | `/order-lists/:listId/items/:productId`   | Sin contenido (`204`)                 |

Una lista tiene `id`, `name`, `itemCount`, `createdAt` y `updatedAt`. Una línea
tiene `productId`, `quantity`, `productActive`, el producto completo del
catálogo y sus fechas. Las líneas de productos desactivados se conservan para
que el usuario pueda retirarlas; no se crean líneas nuevas para productos
inactivos.

El `PUT` de una línea es un upsert idempotente. La clave compuesta
`(order_list_id, product_id)` evita duplicados. Crear una lista recorta el
nombre, limita su longitud a 100 caracteres y permite como máximo 10 listas
por usuario. Al alcanzar el máximo devuelve `409` con:

```json
{
  "code": "ORDER_LIST_LIMIT_REACHED"
}
```

Las respuestas de error conservan ese `code` junto al formato común del API.

## Búsqueda del selector de productos

`GET /products` conserva su búsqueda histórica si no se envía `searchMode`
(nombre, SKU parcial o marca). Para el selector de listas puede enviar:

- `searchMode=name`: nombre parcial, case-insensitive.
- `searchMode=skuExact`: SKU completo, case-insensitive.
- `searchMode=nameOrSkuExact`: nombre parcial o SKU completo.

Los modos desconocidos son `400`. Los filtros `supplierId` y `brandId` siguen
siendo combinables con cualquiera de ellos.
