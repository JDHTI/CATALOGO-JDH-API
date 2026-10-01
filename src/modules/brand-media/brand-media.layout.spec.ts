import {
  brandLogoKey,
  brandSlugFromFilename,
  buildBrandManifest,
  isLogoFile,
  parseBrandLogoKey,
} from './brand-media.layout';

const url = (key: string) => `https://cdn.test/${key}`;

describe('brandSlugFromFilename', () => {
  it('toma la marca del nombre del archivo, normalizado', () => {
    expect(brandSlugFromFilename('alpina.png')).toBe('alpina');
    expect(brandSlugFromFilename('agricola_himalaya.png')).toBe(
      'agricola-himalaya',
    );
    expect(brandSlugFromFilename('listo_El_pollo.png')).toBe('listo-el-pollo');
    expect(brandSlugFromFilename('La Coruña.JPG')).toBe('la-coruna');
  });

  it('solo acepta formatos de imagen', () => {
    expect(isLogoFile('3m.png')).toBe(true);
    expect(isLogoFile('LOGO.WEBP')).toBe(true);
    expect(isLogoFile('cruce-logos.csv')).toBe(false);
    expect(isLogoFile('logo.svg')).toBe(false);
  });
});

describe('brandLogoKey / parseBrandLogoKey', () => {
  it('son inversos', () => {
    const key = brandLogoKey('alpina', 'ab12cd34');
    expect(key).toBe('brands/alpina/logo-ab12cd34.webp');
    expect(parseBrandLogoKey(key)).toBe('alpina');
  });

  it('ignora el manifiesto y keys fuera del contrato', () => {
    expect(parseBrandLogoKey('brands/manifest.json')).toBeNull();
    expect(
      parseBrandLogoKey('brands/alpina/banners/x-0011aabb.webp'),
    ).toBeNull();
    expect(parseBrandLogoKey('logos/marcas/corona.png')).toBeNull();
  });
});

describe('buildBrandManifest', () => {
  it('lista una entrada por marca, ordenada, con la versión más reciente', () => {
    const manifest = buildBrandManifest(
      [
        { key: 'brands/manifest.json' },
        { key: 'brands/nestle/logo-00000001.webp', lastModified: new Date(1) },
        { key: 'brands/nestle/logo-00000002.webp', lastModified: new Date(2) },
        { key: 'brands/3m/logo-0000000b.webp' },
      ],
      url,
      new Date('2026-10-01T00:00:00Z'),
    );

    expect(manifest).toEqual({
      version: 1,
      generadoEn: '2026-10-01T00:00:00.000Z',
      marcas: [
        { slug: '3m', logo: 'https://cdn.test/brands/3m/logo-0000000b.webp' },
        {
          slug: 'nestle',
          logo: 'https://cdn.test/brands/nestle/logo-00000002.webp',
        },
      ],
    });
  });
});
