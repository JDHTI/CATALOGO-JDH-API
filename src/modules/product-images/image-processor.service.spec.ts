import sharp from 'sharp';

import {
  ImageProcessingError,
  ImageProcessorService,
} from './image-processor.service';

/** PNG de prueba: rectángulo rojo semitransparente sobre fondo transparente. */
async function makeTestPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 220, g: 30, b: 30, alpha: 0.6 },
    },
  })
    .png()
    .toBuffer();
}

describe('ImageProcessorService', () => {
  const service = new ImageProcessorService();

  it('genera las 3 variantes cuadradas en WebP con fondo blanco', async () => {
    const original = await makeTestPng(300, 900);

    const result = await service.process(original);

    expect(result.originalWidth).toBe(300);
    expect(result.originalHeight).toBe(900);
    expect(result.checksum).toHaveLength(64);
    expect(result.variants.map((v) => v.name)).toEqual([
      'thumb',
      'card',
      'full',
    ]);

    const card = result.variants.find((v) => v.name === 'card')!;
    const metadata = await sharp(card.buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(600);
    expect(metadata.height).toBe(600);

    // La franja superior queda fuera del rectángulo original (300x900
    // reescalado a 600 de ancho ocupa solo una franja central en alto):
    // debe verse el relleno blanco, no transparencia ni el color fuente.
    const { data, info } = await sharp(card.buffer)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const topLeftPixel = data.subarray(0, info.channels);
    expect(Array.from(topLeftPixel.subarray(0, 3))).toEqual([255, 255, 255]);
  });

  it('el checksum es determinístico para el mismo contenido', async () => {
    const original = await makeTestPng(500, 500);

    const first = await service.process(original);
    const second = await service.process(Buffer.from(original));

    expect(first.checksum).toBe(second.checksum);
  });

  it('rechaza imágenes por debajo del mínimo permitido', async () => {
    const tooSmall = await makeTestPng(100, 100);

    await expect(service.process(tooSmall)).rejects.toThrow(
      ImageProcessingError,
    );
  });
});
