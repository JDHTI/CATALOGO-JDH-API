import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  IMAGE_BACKGROUND,
  IMAGE_VARIANTS,
  MAX_SOURCE_BYTES,
  MIN_SOURCE_DIMENSION,
  WEBP_EFFORT,
  type ImageVariantName,
} from './image-variants.constants';

// `sharp` exporta con `export =` (estilo CJS): el tipo del módulo completo
// ES la función factory, sin `.default`.
type SharpFactory = typeof import('sharp');

export interface ProcessedVariant {
  name: ImageVariantName;
  buffer: Buffer;
}

export interface ProcessedImage {
  /** SHA-256 completo del buffer original, para idempotencia. */
  checksum: string;
  originalWidth: number;
  originalHeight: number;
  variants: ProcessedVariant[];
}

export class ImageProcessingError extends Error {}

/**
 * Conversión de imágenes a WebP con `sharp`. Sin I/O de red ni de base de
 * datos: solo transforma buffers en memoria, lo que la hace fácil de probar.
 *
 * `sharp` se carga con `import()` diferido (nunca en el tope del archivo) a
 * propósito: es una `devDependency` que NO existe en la imagen Docker de
 * producción de la API. Como este método solo se invoca desde el CLI de
 * ingesta (nunca desde un endpoint HTTP), Nest puede instanciar este
 * servicio sin problema aunque el binario nativo no esté instalado.
 */
@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);
  private sharpFactoryPromise?: Promise<SharpFactory>;

  private async loadSharp(): Promise<SharpFactory> {
    this.sharpFactoryPromise ??= import('sharp').then(
      (module: unknown) => (module as { default: SharpFactory }).default,
    );
    return this.sharpFactoryPromise;
  }

  async process(originalBuffer: Buffer): Promise<ProcessedImage> {
    if (originalBuffer.byteLength > MAX_SOURCE_BYTES) {
      throw new ImageProcessingError(
        `Archivo demasiado pesado: ${(originalBuffer.byteLength / 1024 / 1024).toFixed(1)} MB ` +
          `(máximo ${MAX_SOURCE_BYTES / 1024 / 1024} MB)`,
      );
    }

    const sharp = await this.loadSharp();
    const checksum = createHash('sha256').update(originalBuffer).digest('hex');

    const source = sharp(originalBuffer, { failOn: 'none' }).rotate();
    const metadata = await source.metadata();
    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;

    // Área en vez de ancho/alto individuales: fotos de producto legítimas
    // pueden ser angostas y altas (p. ej. un destornillador a 300x900) sin
    // que eso implique baja resolución.
    if (originalWidth * originalHeight < MIN_SOURCE_DIMENSION ** 2) {
      throw new ImageProcessingError(
        `Imagen demasiado pequeña: ${originalWidth}x${originalHeight} ` +
          `(mínimo equivalente a ${MIN_SOURCE_DIMENSION}x${MIN_SOURCE_DIMENSION})`,
      );
    }

    const variants: ProcessedVariant[] = [];
    for (const variant of IMAGE_VARIANTS) {
      const buffer = await sharp(originalBuffer, { failOn: 'none' })
        .rotate()
        .flatten({ background: IMAGE_BACKGROUND })
        .resize(variant.size, variant.size, {
          fit: 'contain',
          background: IMAGE_BACKGROUND,
        })
        .webp({ quality: variant.quality, effort: WEBP_EFFORT })
        .toBuffer();

      variants.push({ name: variant.name, buffer });
    }

    this.logger.debug(
      `Procesada imagen ${originalWidth}x${originalHeight} → ${variants.length} variantes (checksum ${checksum.slice(0, 8)})`,
    );

    return { checksum, originalWidth, originalHeight, variants };
  }
}
