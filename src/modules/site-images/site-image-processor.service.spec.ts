import sharp from 'sharp';

import {
  ImageProcessingError,
  SiteImageProcessorService,
} from './site-image-processor.service';

async function makeTestPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 90, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('SiteImageProcessorService', () => {
  const service = new SiteImageProcessorService();

  it('reencodea a WebP preservando las dimensiones originales', async () => {
    const original = await makeTestPng(1920, 600);

    const webpBuffer = await service.toWebp(original);
    const metadata = await sharp(webpBuffer).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(600);
  });

  it('rechaza archivos por encima del límite de tamaño', async () => {
    const oversized = Buffer.alloc(26 * 1024 * 1024);

    await expect(service.toWebp(oversized)).rejects.toThrow(
      ImageProcessingError,
    );
  });
});
