import { Injectable, Logger } from '@nestjs/common';

// `sharp` exporta con `export =` (estilo CJS): el tipo del módulo completo
// ES la función factory, sin `.default`.
type SharpFactory = typeof import('sharp');

const WEBP_QUALITY = 82;
/** Esfuerzo de compresión WebP de libwebp (0-6): 4 balancea tiempo/peso. */
const WEBP_EFFORT = 4;
/** Límite de tamaño del archivo original de entrada. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export class ImageProcessingError extends Error {}

/**
 * Conversión a WebP para imágenes generales del sitio (hero, banners).
 * A diferencia de `ImageProcessorService` (productos), no genera variantes
 * ni fuerza un lienzo cuadrado: son piezas ya diseñadas al tamaño final, así
 * que solo reencodea preservando dimensiones y transparencia.
 *
 * `sharp` se carga con `import()` diferido a propósito: es una
 * `devDependency` que no existe en la imagen Docker de producción de la API.
 * Como este servicio solo se invoca desde el CLI de carga (nunca desde un
 * endpoint HTTP), Nest puede instanciarlo sin problema aunque el binario
 * nativo no esté instalado.
 */
@Injectable()
export class SiteImageProcessorService {
  private readonly logger = new Logger(SiteImageProcessorService.name);
  private sharpFactoryPromise?: Promise<SharpFactory>;

  private async loadSharp(): Promise<SharpFactory> {
    this.sharpFactoryPromise ??= import('sharp').then(
      (module: unknown) => (module as { default: SharpFactory }).default,
    );
    return this.sharpFactoryPromise;
  }

  async toWebp(originalBuffer: Buffer): Promise<Buffer> {
    if (originalBuffer.byteLength > MAX_SOURCE_BYTES) {
      throw new ImageProcessingError(
        `Archivo demasiado pesado: ${(originalBuffer.byteLength / 1024 / 1024).toFixed(1)} MB ` +
          `(máximo ${MAX_SOURCE_BYTES / 1024 / 1024} MB)`,
      );
    }

    const sharp = await this.loadSharp();
    const buffer = await sharp(originalBuffer, { failOn: 'none' })
      .rotate()
      .webp({ quality: WEBP_QUALITY, effort: WEBP_EFFORT })
      .toBuffer();

    this.logger.debug(`Imagen convertida a WebP (${buffer.byteLength} bytes)`);
    return buffer;
  }
}
