import { parseImageFilename } from './filename-parser';

describe('parseImageFilename', () => {
  it('sin sufijo de galería: un único candidato, posición 0, primaria', () => {
    expect(parseImageFilename('SKU1.png')).toEqual([
      { sku: 'SKU1', position: 0, isPrimary: true },
    ]);
  });

  it('SKU que legítimamente termina en dígitos sin separador no se parte', () => {
    expect(parseImageFilename('REF2024.jpg')).toEqual([
      { sku: 'REF2024', position: 0, isPrimary: true },
    ]);
    expect(parseImageFilename('REF-2024.jpg')).toEqual([
      { sku: 'REF-2024', position: 0, isPrimary: true },
    ]);
  });

  it('sufijo de galería con separador añade un segundo candidato', () => {
    expect(parseImageFilename('123456-2.jpg')).toEqual([
      { sku: '123456-2', position: 0, isPrimary: true },
      { sku: '123456', position: 2, isPrimary: false },
    ]);
  });

  it('posición 1 explícita también se marca primaria en el candidato alterno', () => {
    expect(parseImageFilename('sku_1.webp')).toEqual([
      { sku: 'SKU_1', position: 0, isPrimary: true },
      { sku: 'SKU', position: 1, isPrimary: true },
    ]);
  });

  it('quita sufijos de copia de Windows y en español', () => {
    expect(parseImageFilename('ABC-123 (1).png')).toEqual([
      { sku: 'ABC-123', position: 0, isPrimary: true },
    ]);
    expect(parseImageFilename('SKU100 - copia.png')).toEqual([
      { sku: 'SKU100', position: 0, isPrimary: true },
    ]);
    expect(parseImageFilename('SKU100 - copia (2).png')).toEqual([
      { sku: 'SKU100', position: 0, isPrimary: true },
    ]);
  });

  it('normaliza acentos y espacios repetidos', () => {
    expect(parseImageFilename('Válvula  Térmica.jpeg')).toEqual([
      { sku: 'VALVULA TERMICA', position: 0, isPrimary: true },
    ]);
  });

  it('rechaza nombres sin contenido aprovechable', () => {
    expect(parseImageFilename('.png')).toEqual([]);
    expect(parseImageFilename('   .jpg')).toEqual([]);
  });
});
