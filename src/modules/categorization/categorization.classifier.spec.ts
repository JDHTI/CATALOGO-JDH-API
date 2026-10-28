import {
  buildRuleIndex,
  classify,
  confidenceOf,
  firstWord,
  isServiceItem,
  learnRules,
  normalize,
  ruleKeys,
  signatureOf,
  type LearnSample,
  type ProductFeatures,
} from './categorization.classifier';

const product = (
  name: string,
  linea: string | null,
  sublinea: string | null,
  grupo: string | null,
  tipoItem: string | null = 'Inventario',
): ProductFeatures => ({ name, linea, sublinea, grupo, tipoItem });

/** `n` muestras idénticas de un producto que va al grupo `groupId`. */
const samples = (
  n: number,
  features: ProductFeatures,
  groupId: number,
): LearnSample[] =>
  Array.from({ length: n }, () => ({ product: features, groupId }));

describe('normalización', () => {
  it('quita acentos y mayúsculas y colapsa espacios', () => {
    expect(normalize('  ÁCIDO  Cítrico ')).toBe('acido citrico');
    expect(normalize(null)).toBe('');
  });

  it('toma la primera palabra alfabética del nombre', () => {
    expect(firstWord('Aceite OlioSoya x 3000cc')).toBe('aceite');
    expect(firstWord('  *Vaso 7oz')).toBe('vaso');
    expect(firstWord('123 456')).toBe('');
  });
});

describe('ruleKeys', () => {
  it('arma las cuatro claves cuando hay información completa', () => {
    expect(
      ruleKeys(product('Caja Archivo', 'ASEO', 'INDUSTRIAL', 'RECIPIENTES')),
    ).toEqual({
      lsg: 'aseo|industrial|recipientes',
      lsg_w: 'aseo|industrial|recipientes|caja',
      g_w: 'recipientes|caja',
      w: 'caja',
    });
  });

  it('omite las claves que dependen de un dato vacío', () => {
    expect(ruleKeys(product('Caja', null, null, null))).toEqual({ w: 'caja' });
    expect(ruleKeys(product('123', 'A', 'B', 'C'))).toEqual({
      lsg: 'a|b|c',
    });
  });
});

describe('signatureOf', () => {
  it('no cambia si solo cambia el nombre', () => {
    const a = product('Aceite', 'DESPENSA', 'SECOS', 'ACEITES');
    const b = product('Aceite corregido', 'DESPENSA', 'SECOS', 'ACEITES');
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('cambia si el ERP mueve el producto de línea, sublínea, grupo o tipo', () => {
    const base = product('X', 'DESPENSA', 'SECOS', 'ACEITES');
    const signatures = new Set([
      signatureOf(base),
      signatureOf({ ...base, linea: 'ALIMENTOS' }),
      signatureOf({ ...base, sublinea: 'FRIOS' }),
      signatureOf({ ...base, grupo: 'SALSAS' }),
      signatureOf({ ...base, tipoItem: 'Servicio' }),
    ]);
    expect(signatures.size).toBe(5);
  });

  it('ignora mayúsculas y acentos', () => {
    expect(signatureOf(product('X', 'Despensa', null, null))).toBe(
      signatureOf(product('X', 'DESPENSA', null, null)),
    );
  });
});

describe('isServiceItem', () => {
  it('reconoce el tipo de ítem Servicio sin importar la forma', () => {
    expect(isServiceItem(product('Flete', null, null, null, 'Servicio'))).toBe(
      true,
    );
    expect(
      isServiceItem(product('Flete', null, null, null, ' SERVICIO ')),
    ).toBe(true);
    expect(
      isServiceItem(product('Arroz', null, null, null, 'Inventario')),
    ).toBe(false);
  });
});

describe('learnRules', () => {
  const arroz = product('Arroz Diana', 'DESPENSA', 'GRANOS', 'ARROZ');

  it('aprende la regla lsg de un grupo ERP consistente', () => {
    const rules = learnRules(samples(5, arroz, 7));

    expect(rules).toContainEqual(
      expect.objectContaining({
        kind: 'lsg',
        ruleKey: 'despensa|granos|arroz',
        groupId: 7,
        support: 5,
        purity: 1,
      }),
    );
  });

  it('no promueve una clave con poca pureza', () => {
    // 6 a un grupo y 4 a otro: 60% < 90%.
    const rules = learnRules([
      ...samples(6, arroz, 7),
      ...samples(4, arroz, 8),
    ]);

    expect(rules.filter((r) => r.kind === 'lsg')).toEqual([]);
  });

  it('un grupo ERP heterogéneo se resuelve por la primera palabra del nombre', () => {
    const caja = product('Caja plastica', 'ASEO', 'INDUSTRIAL', 'RECIPIENTES');
    const tapa = product(
      'Tapa contenedor',
      'ASEO',
      'INDUSTRIAL',
      'RECIPIENTES',
    );
    const rules = learnRules([...samples(6, caja, 1), ...samples(6, tapa, 2)]);

    // Mezclado, ni el triple ERP (50%) ni la sola línea alcanzan pureza…
    expect(rules.some((r) => r.kind === 'lsg')).toBe(false);
    // …pero «caja» y «tapa» dentro de ese grupo sí.
    expect(rules).toContainEqual(
      expect.objectContaining({
        kind: 'lsg_w',
        ruleKey: 'aseo|industrial|recipientes|caja',
        groupId: 1,
      }),
    );
    expect(rules).toContainEqual(
      expect.objectContaining({
        kind: 'lsg_w',
        ruleKey: 'aseo|industrial|recipientes|tapa',
        groupId: 2,
      }),
    );
  });

  it('poda las reglas lsg_w redundantes con su lsg', () => {
    const rules = learnRules(samples(8, arroz, 7));

    expect(rules.some((r) => r.kind === 'lsg_w')).toBe(false);
  });

  it('es determinista ante un empate (gana el grupo de menor id)', () => {
    const rules = learnRules(
      [...samples(5, arroz, 9), ...samples(5, arroz, 3)],
      {
        lsg_w: { purity: 0.5, support: 1 },
        lsg: { purity: 0.5, support: 1 },
        g_w: { purity: 0.5, support: 1 },
        w: { purity: 0.5, support: 1 },
      },
    );

    expect(rules.find((r) => r.kind === 'lsg')?.groupId).toBe(3);
  });
});

describe('classify', () => {
  const trainingSet = [
    ...samples(10, product('Arroz Diana', 'DESPENSA', 'GRANOS', 'ARROZ'), 7),
    ...samples(
      8,
      product('Caja plastica', 'ASEO', 'INDUSTRIAL', 'RECIPIENTES'),
      1,
    ),
    ...samples(
      8,
      product('Tapa contenedor', 'ASEO', 'INDUSTRIAL', 'RECIPIENTES'),
      2,
    ),
  ];
  const index = buildRuleIndex(learnRules(trainingSet));

  it('usa la clasificación ERP cuando la conoce', () => {
    const hit = classify(
      product('Cualquier nombre', 'DESPENSA', 'GRANOS', 'ARROZ'),
      index,
    );

    expect(hit).toMatchObject({ kind: 'lsg', groupId: 7 });
  });

  it('en un grupo ERP heterogéneo decide por el nombre', () => {
    const caja = classify(
      product('Caja Archivo 9x12', 'ASEO', 'INDUSTRIAL', 'RECIPIENTES'),
      index,
    );
    const tapa = classify(
      product('Tapa Domo', 'ASEO', 'INDUSTRIAL', 'RECIPIENTES'),
      index,
    );

    expect(caja).toMatchObject({ kind: 'lsg_w', groupId: 1 });
    expect(tapa).toMatchObject({ kind: 'lsg_w', groupId: 2 });
  });

  it('devuelve null si ninguna regla aplica (queda pendiente)', () => {
    expect(
      classify(product('Producto raro', 'NUEVA', 'LINEA', 'GRUPO'), index),
    ).toBeNull();
    expect(
      classify(product('Caja', 'ASEO', 'INDUSTRIAL', 'OTRO GRUPO'), index),
    ).toBeNull();
  });

  it('un índice vacío no clasifica nada', () => {
    expect(classify(product('Arroz', 'A', 'B', 'C'), new Map())).toBeNull();
  });
});

describe('confidenceOf', () => {
  const hit = (
    kind: 'lsg' | 'lsg_w' | 'g_w' | 'w',
    support: number,
    purity: number,
  ) => ({
    kind,
    groupId: 1,
    support,
    purity,
  });

  it('alta solo para reglas ERP con respaldo y casi sin excepciones', () => {
    expect(confidenceOf(hit('lsg', 50, 1))).toBe('alta');
    expect(confidenceOf(hit('lsg_w', 3, 0.97))).toBe('alta');
  });

  it('media en el resto', () => {
    expect(confidenceOf(hit('lsg', 2, 1))).toBe('media');
    expect(confidenceOf(hit('lsg', 50, 0.93))).toBe('media');
    expect(confidenceOf(hit('g_w', 50, 1))).toBe('media');
    expect(confidenceOf(hit('w', 50, 1))).toBe('media');
  });
});
