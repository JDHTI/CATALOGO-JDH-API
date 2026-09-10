/**
 * Tope de ids que devuelve `GET /favorites/ids`.
 *
 * Ese endpoint existe para que el grid del catálogo sepa de una sola petición
 * cuáles de los productos visibles están en favoritos, así que la respuesta
 * tiene que caber cómoda en una caché de cliente. En un catálogo B2B lo
 * esperable son decenas de favoritos; el tope solo evita que una cuenta
 * anómala devuelva una lista sin techo.
 *
 * `total` NO se recorta: es el conteo real, para que el contador del header
 * siga siendo correcto aunque `ids` venga truncada.
 */
export const FAVORITE_IDS_LIMIT = 1_000;
