export type ImageVariantName = 'thumb' | 'card' | 'full';

export interface ImageVariantSpec {
  name: ImageVariantName;
  /** Lado del lienzo cuadrado, en píxeles. */
  size: number;
  /** Calidad WebP (0-100). */
  quality: number;
}

/** thumb: listados densos · card: grid del catálogo · full: detalle/zoom. */
export const IMAGE_VARIANTS: readonly ImageVariantSpec[] = [
  { name: 'thumb', size: 200, quality: 78 },
  { name: 'card', size: 600, quality: 82 },
  { name: 'full', size: 1600, quality: 82 },
];

/** Fondo con el que se aplana la transparencia y se rellena el lienzo. */
export const IMAGE_BACKGROUND = '#ffffff';

/** Esfuerzo de compresión WebP de libwebp (0-6): 4 balancea tiempo/peso. */
export const WEBP_EFFORT = 4;

/** Por debajo de esto la imagen se rechaza: no alcanza para un `full` nítido. */
export const MIN_SOURCE_DIMENSION = 400;

/** Límite de tamaño del archivo original entregado por el proveedor. */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
