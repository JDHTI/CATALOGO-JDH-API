/**
 * Fila de la vista `consumo.productos` del DWH.
 *
 * Notas de la fuente (ver docs/products-sync.md):
 * - `producto_key` es un hash surrogate estable: es la clave del upsert.
 * - `sku_proveedor` es la DESCRIPCIÓN CORTA del ERP, no un código.
 * - `cod_proveedor`/`proveedor` es una clasificación comercial (criterio
 *   mayor t106), no una identidad jurídica.
 * - `fecha_actualizacion` viene SIEMPRE NULL, por eso no se selecciona.
 * - Los numeric de pg llegan como string.
 */
export interface DwhProductRow {
  [column: string]: unknown;
  producto_key: string;
  sku: string;
  sku_proveedor: string | null;
  descripcion: string | null;
  fecha_creacion: Date | null;
  estado: string | null;
  tipo_item: string | null;
  cod_proveedor: string | null;
  proveedor: string | null;
  fabricante: string | null;
  marca: string | null;
  origen: string | null;
  linea: string | null;
  sublinea: string | null;
  grupo: string | null;
  peso: string | null;
  factor_empaque: string | null;
}
