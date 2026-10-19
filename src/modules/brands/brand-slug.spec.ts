import {
  allocateBrandSlug,
  brandSlugBase,
  isBrandSlugFor,
  planBrandSlugs,
} from './brand-slug';

describe('brandSlugBase', () => {
  it('normaliza igual que los nombres de archivo de logos', () => {
    expect(brandSlugBase('NESCAFE DOLCE GUSTO')).toBe('nescafe-dolce-gusto');
    expect(brandSlugBase('DOÑA PAULA')).toBe('dona-paula');
    expect(brandSlugBase('HERSHEY´S')).toBe('hershey-s');
    expect(brandSlugBase('SANTO FRÍO S.A.S')).toBe('santo-frio-s-a-s');
    expect(brandSlugBase('MANTHÝS')).toBe('manthys');
  });

  it('cae a "marca" si el nombre no tiene letras ni dígitos', () => {
    expect(brandSlugBase('***')).toBe('marca');
  });
});

describe('allocateBrandSlug', () => {
  it('usa la base si está libre y `{base}-{id}` si no', () => {
    const brand = { id: 7, name: 'Acme.' };
    expect(allocateBrandSlug(brand, new Set())).toBe('acme');
    expect(allocateBrandSlug(brand, new Set(['acme']))).toBe('acme-7');
  });

  it('desempata si otra marca se llama literalmente `{base}-{id}`', () => {
    expect(
      allocateBrandSlug({ id: 7, name: 'Acme.' }, new Set(['acme', 'acme-7'])),
    ).toBe('acme-7-2');
  });
});

describe('isBrandSlugFor', () => {
  it('admite la base y las variantes con el id propio', () => {
    const brand = { id: 7, name: 'ACME' };
    expect(isBrandSlugFor('acme', brand)).toBe(true);
    expect(isBrandSlugFor('acme-7', brand)).toBe(true);
    expect(isBrandSlugFor('acme-7-2', brand)).toBe(true);
    expect(isBrandSlugFor('acme-8', brand)).toBe(false);
    expect(isBrandSlugFor('otra', brand)).toBe(false);
  });
});

describe('planBrandSlugs', () => {
  it('no toca los slugs válidos', () => {
    expect(
      planBrandSlugs([
        { id: 1, name: 'ACME', slug: 'acme' },
        { id: 2, name: 'Acme.', slug: 'acme-2' },
      ]),
    ).toEqual([]);
  });

  it('reasigna por id ascendente sin quitarle la base a quien ya la tiene', () => {
    expect(
      planBrandSlugs([
        { id: 9, name: 'ACME!', slug: '~pendiente' },
        { id: 5, name: 'ACME', slug: 'acme' },
        // Renombrada en BD: su slug viejo ya no le corresponde.
        { id: 3, name: 'Acme Co', slug: 'acme-viejo' },
      ]),
    ).toEqual([
      { id: 3, slug: 'acme-co' },
      { id: 9, slug: 'acme-9' },
    ]);
  });
});
