/** Tope de unidades por línea. */
export const MAX_LINE_QUANTITY = 9999;

/** Tope de productos distintos en un carrito. */
export const MAX_CART_LINES = 200;

/** Prefijo del consecutivo legible del pedido. */
export function orderNumber(number: number): string {
  return `PED-${String(number).padStart(6, '0')}`;
}
