import {
  assignKindPositions,
  kindRank,
  parseGalleryPosition,
  parseImageFilename,
  parseImageKindFolder,
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
    expect(parseProductFolderName('1-1001-FRUCO TOMATE 4350 G')).toEqual({
      ref: '1001',
      productName: 'FRUCO TOMATE 4350 G',
      objectFolder: '1001-fruco-tomate-4350-g',
    });
  });

  it('normaliza acentos, comas y guiones bajos en el slug', () => {
    expect(
      parseProductFolderName('46-13899-HELLMANN_S MAYOBASE 3,77 KG'),
    ).toEqual({
      ref: '13899',
      productName: 'HELLMANN_S MAYOBASE 3,77 KG',
      objectFolder: '13899-hellmann-s-mayobase-3-77-kg',
    });
    expect(
      parseProductFolderName('63-13665-MAIZENA NATILLA MARACUYÁ 300G')
        ?.objectFolder,
    ).toBe('13665-maizena-natilla-maracuya-300g');
  });

  it('conserva los guiones del nombre del producto', () => {
    expect(parseProductFolderName('7-1032-SALSA X-TREME 1 L')).toMatchObject({
      ref: '1032',
      objectFolder: '1032-salsa-x-treme-1-l',
    });
  });

  it('devuelve null para carpetas que no siguen el layout', () => {
    // Carpeta de marca y carpeta de proveedor del layout plano.
    expect(parseProductFolderName('1.FRUCO 2000X2000 PX')).toBeNull();
    expect(parseProductFolderName('399')).toBeNull();
    expect(parseProductFolderName('ACO-UNILEVER')).toBeNull();
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

  it('ignora sufijos de copia de Windows', () => {
    expect(parseGalleryPosition('1B-1001-FRUCO TOMATE 4350 G (1).png')).toBe(1);
  });

  it('devuelve null si el archivo no sigue el layout', () => {
    // Adivinar 0 aquí sobreescribiría la imagen principal del producto.
    expect(parseGalleryPosition('C100306453_7702047038796.NP.tif')).toBeNull();
    expect(parseGalleryPosition('1001.png')).toBeNull();
  });
});

describe('parseImageKindFolder', () => {
  it('lee el prefijo con o sin sufijo descriptivo', () => {
    expect(parseImageKindFolder('p-producto')).toBe('principal');
    expect(parseImageKindFolder('p')).toBe('principal');
    expect(parseImageKindFolder('d-detalle')).toBe('detalle');
    expect(parseImageKindFolder('d')).toBe('detalle');
    expect(parseImageKindFolder('tn-tabla-nutricional')).toBe(
      'tabla_nutricional',
    );
    expect(parseImageKindFolder('tn')).toBe('tabla_nutricional');
  });

  it('tn no se confunde con d ni con p', () => {
    // Si 'd' se probara antes que 'tn' por orden de prefijos, 'tn-...' seguiria
    // funcionando, pero el orden importa si algun dia se agrega un prefijo 't'.
    expect(parseImageKindFolder('tn-tabla')).toBe('tabla_nutricional');
    expect(parseImageKindFolder('TN-Tabla Nutricional')).toBe(
      'tabla_nutricional',
    );
  });

  it('normaliza mayusculas y acentos', () => {
    expect(parseImageKindFolder('P-Producto')).toBe('principal');
    expect(parseImageKindFolder('tn-tabla-nutricionál')).toBe(
      'tabla_nutricional',
    );
  });

  it('devuelve null para carpetas que no son de clasificacion', () => {
    // Esto es lo que distingue una subcarpeta de tipo de la carpeta de producto.
    expect(parseImageKindFolder('64-19977-MAIZENA BUÑUELOS 300G')).toBeNull();
    expect(parseImageKindFolder('1.FRUCO 2000X2000 PX')).toBeNull();
    expect(parseImageKindFolder('399')).toBeNull();
    expect(parseImageKindFolder('detalle')).toBeNull();
  });
});

describe('assignKindPositions', () => {
  it('ordena principal, luego detalle, luego tabla nutricional', () => {
    const files = [
      { kind: 'tabla_nutricional' as const, filename: '64D-19977-X.png' },
      { kind: 'principal' as const, filename: '64-19977-X.png' },
      { kind: 'detalle' as const, filename: '64C-19977-X.png' },
      { kind: 'principal' as const, filename: '64B-19977-X.png' },
    ];

    // La entrada esta desordenada a proposito: las posiciones se devuelven en
    // el orden de `files`, no en el orden ordenado.
    expect(assignKindPositions(files)).toEqual([3, 0, 2, 1]);
  });

  it('la posicion 0 es una foto de producto aunque la letra diga otra cosa', () => {
    // El proveedor puso la tabla nutricional en el archivo SIN letra, que en
    // el layout viejo habria sido la primaria del catalogo.
    const files = [
      { kind: 'tabla_nutricional' as const, filename: '64-19977-X.png' },
      { kind: 'principal' as const, filename: '64C-19977-X.png' },
    ];

    const positions = assignKindPositions(files);

    expect(positions).toEqual([1, 0]);
    expect(files[positions.indexOf(0)].kind).toBe('principal');
  });

  it('dentro de un tipo respeta la letra del consecutivo, no el orden de texto', () => {
    // localeCompare puede poner "64B-" antes de "64-"; la letra manda.
    const files = [
      { kind: 'principal' as const, filename: '64B-19977-X.png' },
      { kind: 'principal' as const, filename: '64-19977-X.png' },
      { kind: 'principal' as const, filename: '64C-19977-X.png' },
    ];

    expect(assignKindPositions(files)).toEqual([1, 0, 2]);
  });

  it('un producto de una sola imagen queda en la posicion 0', () => {
    expect(
      assignKindPositions([{ kind: 'principal', filename: '64-19977-X.png' }]),
    ).toEqual([0]);
  });

  it('los sin clasificar van al final', () => {
    const files = [
      { kind: null, filename: 'suelto.png' },
      { kind: 'principal' as const, filename: '64-19977-X.png' },
    ];

    expect(assignKindPositions(files)).toEqual([1, 0]);
  });

  it('sin ninguna principal no se promueve nada a la posicion 0 por tipo', () => {
    // Queda tabla_nutricional en 0 porque es lo unico que hay; el CLI lo
    // reporta y la decision de que hacer es del operador.
    const files = [
      { kind: 'tabla_nutricional' as const, filename: '64D-19977-X.png' },
      { kind: 'detalle' as const, filename: '64C-19977-X.png' },
    ];

    const positions = assignKindPositions(files);
    expect(files[positions.indexOf(0)].kind).toBe('detalle');
  });
});

describe('kindRank', () => {
  it('ordena los tipos y deja null al final', () => {
    expect(kindRank('principal')).toBeLessThan(kindRank('detalle'));
    expect(kindRank('detalle')).toBeLessThan(kindRank('tabla_nutricional'));
    expect(kindRank('tabla_nutricional')).toBeLessThan(kindRank(null));
  });
});

describe('parseProductFolderCandidates', () => {
  it('la referencia sale de la carpeta y la posición del archivo', () => {
    expect(
      parseProductFolderCandidates(
        '1-1001-FRUCO TOMATE 4350 G',
        '1C-1001-FRUCO TOMATE 4350 G.png',
      ),
    ).toEqual([
      {
        sku: '1001',
        position: 2,
        isPrimary: false,
        objectFolder: '1001-fruco-tomate-4350-g',
      },
    ]);
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
  });
});
