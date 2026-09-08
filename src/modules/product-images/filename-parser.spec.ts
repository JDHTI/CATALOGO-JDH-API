import {
  parseGalleryPosition,
  parseImageFilename,
  parseProductFolderCandidates,
  parseProductFolderName,
} from './filename-parser';

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

describe('parseProductFolderName', () => {
  it('quita el consecutivo y deja referencia + nombre en slug', () => {
    expect(parseProductFolderName('1-1001-FRUCO TOMATE 4350 G')[0]).toEqual({
      ref: '1001',
      productName: 'FRUCO TOMATE 4350 G',
      objectFolder: '1001-fruco-tomate-4350-g',
      layout: 'consecutivo-primero',
    });
  });

  it('normaliza acentos, comas y guiones bajos en el slug', () => {
    expect(
      parseProductFolderName('46-13899-HELLMANN_S MAYOBASE 3,77 KG')[0],
    ).toEqual({
      ref: '13899',
      productName: 'HELLMANN_S MAYOBASE 3,77 KG',
      objectFolder: '13899-hellmann-s-mayobase-3-77-kg',
      layout: 'consecutivo-primero',
    });
    expect(
      parseProductFolderName('63-13665-MAIZENA NATILLA MARACUYÁ 300G')[0]
        .objectFolder,
    ).toBe('13665-maizena-natilla-maracuya-300g');
  });

  it('conserva los guiones del nombre del producto', () => {
    expect(parseProductFolderName('7-1032-SALSA X-TREME 1 L')[0]).toMatchObject(
      { ref: '1032', objectFolder: '1032-salsa-x-treme-1-l' },
    );
  });

  it('lee la referencia primero cuando la carpeta no trae nombre', () => {
    expect(parseProductFolderName('0212-01')).toEqual([
      {
        ref: '0212',
        productName: '',
        objectFolder: '0212',
        layout: 'referencia-primero',
      },
    ]);
    expect(parseProductFolderName('0212-02')[0].ref).toBe('0212');
  });

  it('con nombre, ambos órdenes son posibles: primero la referencia más larga', () => {
    // `1001-1-NOMBRE` y `1-1001-NOMBRE` tienen la misma forma; la base decide.
    expect(
      parseProductFolderName('1001-1-FRUCO TOMATE 4350 G').map((f) => [
        f.ref,
        f.layout,
      ]),
    ).toEqual([
      ['1001', 'referencia-primero'],
      ['1', 'consecutivo-primero'],
    ]);
    expect(
      parseProductFolderName('1-1001-FRUCO TOMATE 4350 G').map((f) => [
        f.ref,
        f.layout,
      ]),
    ).toEqual([
      ['1001', 'consecutivo-primero'],
      ['1', 'referencia-primero'],
    ]);
  });

  it('devuelve vacío para carpetas que no siguen ningún layout', () => {
    // Carpeta de marca y carpeta de proveedor del layout plano.
    expect(parseProductFolderName('1.FRUCO 2000X2000 PX')).toEqual([]);
    expect(parseProductFolderName('399')).toEqual([]);
    expect(parseProductFolderName('ACO-UNILEVER')).toEqual([]);
  });
});

describe('parseGalleryPosition', () => {
  it('sin letra es la principal', () => {
    expect(parseGalleryPosition('1-1001-FRUCO TOMATE 4350 G.png')).toBe(0);
  });

  it('la letra del consecutivo define la posición', () => {
    expect(parseGalleryPosition('1B-1001-FRUCO TOMATE 4350 G.png')).toBe(1);
    expect(parseGalleryPosition('1C-1001-FRUCO TOMATE 4350 G.png')).toBe(2);
    expect(
      parseGalleryPosition('40D-28319-FRUCO MAYONESA SQUEEZE 330 G.png'),
    ).toBe(3);
  });

  it('con referencia primero la letra va al final del consecutivo', () => {
    const layout = 'referencia-primero';
    expect(parseGalleryPosition('0212-01.png', layout)).toBe(0);
    expect(parseGalleryPosition('0212-01B.png', layout)).toBe(1);
    expect(parseGalleryPosition('0212-01C.png', layout)).toBe(2);
    expect(
      parseGalleryPosition('1001-1B-FRUCO TOMATE 4350 G.png', layout),
    ).toBe(1);
  });

  it('ignora sufijos de copia de Windows', () => {
    expect(parseGalleryPosition('1B-1001-FRUCO TOMATE 4350 G (1).png')).toBe(1);
    expect(
      parseGalleryPosition('0212-01B (1).png', 'referencia-primero'),
    ).toBe(1);
  });

  it('devuelve null si el archivo no sigue el layout', () => {
    // Adivinar 0 aquí sobreescribiría la imagen principal del producto.
    expect(parseGalleryPosition('C100306453_7702047038796.NP.tif')).toBeNull();
    expect(parseGalleryPosition('1001.png')).toBeNull();
    expect(
      parseGalleryPosition(
        'C100306453_7702047038796.NP.tif',
        'referencia-primero',
      ),
    ).toBeNull();
    expect(parseGalleryPosition('0212.png', 'referencia-primero')).toBeNull();
  });
});

describe('parseProductFolderCandidates', () => {
  it('la referencia sale de la carpeta y la posición del archivo', () => {
    const [primero] = parseProductFolderCandidates(
      '1-1001-FRUCO TOMATE 4350 G',
      '1C-1001-FRUCO TOMATE 4350 G.png',
    );
    expect(primero).toEqual({
      sku: '1001',
      position: 2,
      isPrimary: false,
      objectFolder: '1001-fruco-tomate-4350-g',
    });
  });

  it('carpeta referencia-consecutivo sin nombre: sube a la carpeta de la ref', () => {
    expect(parseProductFolderCandidates('0212-01', '0212-01.png')).toEqual([
      { sku: '0212', position: 0, isPrimary: true, objectFolder: '0212' },
    ]);
    expect(parseProductFolderCandidates('0212-01', '0212-01B.png')).toEqual([
      { sku: '0212', position: 1, isPrimary: false, objectFolder: '0212' },
    ]);
  });

  it('con nombre en ambos lados, el candidato de la ref más larga va primero', () => {
    expect(
      parseProductFolderCandidates(
        '1001-1-FRUCO TOMATE 4350 G',
        '1001-1B-FRUCO TOMATE 4350 G.png',
      )[0],
    ).toEqual({
      sku: '1001',
      position: 1,
      isPrimary: false,
      objectFolder: '1001-fruco-tomate-4350-g',
    });
  });

  it('no propone candidato si la carpeta no trae referencia', () => {
    expect(parseProductFolderCandidates('399', '1001.png')).toEqual([]);
  });

  it('no propone candidato si no se puede deducir la posición', () => {
    expect(
      parseProductFolderCandidates(
        '2-1008-FRUCO SALSA ROSADA 380 G',
        'C100306453_7702047038796.NP.tif',
      ),
    ).toEqual([]);
    expect(
      parseProductFolderCandidates(
        '0212-01',
        'C100306453_7702047038796.NP.tif',
      ),
    ).toEqual([]);
  });
});
