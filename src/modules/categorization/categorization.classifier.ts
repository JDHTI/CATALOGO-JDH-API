import { createHash } from 'node:crypto';

/**
 * Clasificador de productos nuevos o reclasificados. Funciones puras, sin BD,
 * para poder probarlas y evaluarlas aisladas. Ver docs/categorization.md.
 *
 * ## Qué aprende y de dónde
 *
 * Las reglas se derivan de las asignaciones ya revisadas (`propuesta` y
 * `manual`). Cada regla liga una *clave* de un producto con el grupo al que casi
 * siempre va. Hay cuatro tipos de clave, de más a menos específica:
 *
 *   lsg_w  línea | sublínea | grupo ERP | primera palabra del nombre
 *   lsg    línea | sublínea | grupo ERP
 *   g_w    grupo ERP | primera palabra del nombre
 *   w      primera palabra del nombre
 *
 * `lsg` resuelve casi todo, porque la clasificación ERP ya agrupa el producto.
 * `lsg_w` existe para los grupos ERP heterogéneos (p. ej. «RECIPIENTES», donde
 * conviven cajas, tapas y canecas): ahí manda el tipo de producto que dice el
 * nombre («Caja ...», «Tapa ...»). `g_w` y `w` cubren combinaciones que el ERP
 * no había visto nunca.
 *
 * La clasificación se corta en el primer tipo de regla que acierta; si ninguno
 * lo hace, el producto queda PENDIENTE (sin asignación) en vez de recibir una
 * categoría inventada.
 */

export const RULE_KINDS = ['lsg_w', 'lsg', 'g_w', 'w'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export type Confidence = 'alta' | 'media' | 'baja';

/** Lo que el clasificador necesita saber de un producto. */
export interface ProductFeatures {
  name: string;
  linea: string | null;
  sublinea: string | null;
  grupo: string | null;
  tipoItem: string | null;
}

/** Minúsculas, sin acentos y con los espacios colapsados. */
export function normalize(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Primer token alfabético del nombre («Aceite OlioSoya x 3000cc» → `aceite`). */
export function firstWord(name: string | null | undefined): string {
  return /[a-z]+/.exec(normalize(name))?.[0] ?? '';
}

/**
 * Claves de regla de un producto. Un componente vacío invalida las claves que
 * lo usan (no hay información que aprender de «línea vacía»).
 */
export function ruleKeys(
  product: ProductFeatures,
): Partial<Record<RuleKind, string>> {
  const l = normalize(product.linea);
  const s = normalize(product.sublinea);
  const g = normalize(product.grupo);
  const w = firstWord(product.name);

  const keys: Partial<Record<RuleKind, string>> = {};
  if (l || s || g) {
    keys.lsg = `${l}|${s}|${g}`;
    if (w) keys.lsg_w = `${l}|${s}|${g}|${w}`;
  }
  if (g && w) keys.g_w = `${g}|${w}`;
  if (w) keys.w = w;
  return keys;
}

/**
 * Huella de la clasificación cruda del ERP. Si cambia entre dos corridas, la
 * asignación automática del producto se reevalúa; el nombre NO entra, para que
 * corregir una errata no reclasifique.
 */
export function signatureOf(product: ProductFeatures): string {
  const raw = [
    normalize(product.linea),
    normalize(product.sublinea),
    normalize(product.grupo),
    normalize(product.tipoItem),
  ].join('|');
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/** Los ítems tipo Servicio van siempre a la categoría Servicios. */
export function isServiceItem(product: ProductFeatures): boolean {
  return normalize(product.tipoItem) === 'servicio';
}

export interface LearnSample {
  product: ProductFeatures;
  groupId: number;
}

export interface LearnedRule {
  kind: RuleKind;
  ruleKey: string;
  groupId: number;
  /** Productos de entrenamiento con esa clave. */
  support: number;
  /** Fracción de ellos que va al grupo ganador (0–1). */
  purity: number;
}

/** Pureza y respaldo mínimos para promover una clave a regla. */
export const LEARN_THRESHOLDS: Record<
  RuleKind,
  { purity: number; support: number }
> = {
  lsg_w: { purity: 0.9, support: 3 },
  lsg: { purity: 0.9, support: 1 },
  g_w: { purity: 0.9, support: 6 },
  // La más débil (ignora la clasificación ERP): solo con casi total acuerdo.
  w: { purity: 0.95, support: 20 },
};

/** Aprende reglas de un conjunto de productos ya clasificados. */
export function learnRules(
  samples: readonly LearnSample[],
  thresholds = LEARN_THRESHOLDS,
): LearnedRule[] {
  // kind → clave → grupo → conteo
  const counts = new Map<RuleKind, Map<string, Map<number, number>>>(
    RULE_KINDS.map((kind) => [kind, new Map()]),
  );

  for (const { product, groupId } of samples) {
    const keys = ruleKeys(product);
    for (const kind of RULE_KINDS) {
      const key = keys[kind];
      if (key === undefined) continue;
      const byKey = counts.get(kind)!;
      const byGroup = byKey.get(key) ?? new Map<number, number>();
      byGroup.set(groupId, (byGroup.get(groupId) ?? 0) + 1);
      byKey.set(key, byGroup);
    }
  }

  const rules: LearnedRule[] = [];
  for (const kind of RULE_KINDS) {
    const { purity: minPurity, support: minSupport } = thresholds[kind];
    for (const [ruleKey, byGroup] of counts.get(kind)!) {
      let total = 0;
      let best = { groupId: 0, count: 0 };
      for (const [groupId, count] of byGroup) {
        total += count;
        // Empate: gana el id menor, para que reaprender sea determinista.
        if (
          count > best.count ||
          (count === best.count && groupId < best.groupId)
        ) {
          best = { groupId, count };
        }
      }
      const purity = best.count / total;
      if (total < minSupport || purity < minPurity) continue;
      rules.push({
        kind,
        ruleKey,
        groupId: best.groupId,
        support: total,
        purity,
      });
    }
  }

  return pruneRedundant(rules);
}

/**
 * Una regla `lsg_w` que manda al mismo grupo que su regla `lsg` no aporta
 * nada: el producto llegaría ahí igual. Quitarlas deja solo las que resuelven
 * grupos ERP heterogéneos.
 */
function pruneRedundant(rules: LearnedRule[]): LearnedRule[] {
  const lsg = new Map(
    rules.filter((r) => r.kind === 'lsg').map((r) => [r.ruleKey, r.groupId]),
  );
  return rules.filter((rule) => {
    if (rule.kind !== 'lsg_w') return true;
    const triple = rule.ruleKey.slice(0, rule.ruleKey.lastIndexOf('|'));
    return lsg.get(triple) !== rule.groupId;
  });
}

export interface RuleHit {
  kind: RuleKind;
  groupId: number;
  support: number;
  purity: number;
}

/** Índice `tipo\0clave → regla` para consultar en O(1). */
export type RuleIndex = Map<string, RuleHit>;

const indexKey = (kind: RuleKind, ruleKey: string): string =>
  `${kind}\u0000${ruleKey}`;

export function buildRuleIndex(rules: readonly LearnedRule[]): RuleIndex {
  return new Map(
    rules.map((rule) => [
      indexKey(rule.kind, rule.ruleKey),
      {
        kind: rule.kind,
        groupId: rule.groupId,
        support: rule.support,
        purity: rule.purity,
      },
    ]),
  );
}

/** Primera regla que acierta, de la más a la menos específica; `null` si ninguna. */
export function classify(
  product: ProductFeatures,
  index: RuleIndex,
): RuleHit | null {
  const keys = ruleKeys(product);
  for (const kind of RULE_KINDS) {
    const key = keys[kind];
    if (key === undefined) continue;
    const hit = index.get(indexKey(kind, key));
    if (hit) return hit;
  }
  return null;
}

/**
 * Confianza de una asignación automática. `alta` solo para reglas que parten
 * de la clasificación ERP completa, con respaldo y casi sin excepciones; el
 * resto queda `media` y se marca para revisión.
 */
export function confidenceOf(hit: RuleHit): Confidence {
  const fromErp = hit.kind === 'lsg' || hit.kind === 'lsg_w';
  return fromErp && hit.support >= 3 && hit.purity >= 0.97 ? 'alta' : 'media';
}
