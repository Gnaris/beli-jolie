/**
 * eFashion Paris — Snapshot + diff de synchronisation.
 *
 * Stocké dans `Product.efashionLastSyncSnapshot` (Json). Sert à n'envoyer que
 * les changements à eFashion lors d'une mise à jour (`update`), comme on le
 * fait déjà pour PFS et Ankorstore.
 */

export interface EfashionVariantSnapshot {
  efashionProductId: number;
  visible: boolean;
  prix: number;
  poids: number;
  stockByTaille: Record<string, number>; // taille string ("TU", "S", ...) → quantité
}

/**
 * Description multilingue d'un produit eFashion. eFashion expose un champ par
 * langue (`texte_fr`, `texte_uk`, `texte_it`, `texte_es`, `texte_zh`). On garde
 * en interne les codes locale BJ (`fr`, `en`, ...) — la traduction en
 * `texte_uk` se fait au moment de l'appel API.
 */
export interface EfashionDescriptions {
  fr: string;
  en: string;
  it: string;
  es: string;
  zh: string;
}

/**
 * Composition (matière) d'un produit eFashion. `id` = id eFashion de la
 * matière, `localisationId` = zone d'application (4 = Produit observé),
 * `percentage` = pourcentage de cette matière dans la composition.
 */
export interface EfashionCompositionSnapshot {
  id: number;
  localisationId: number;
  percentage: number;
}

export interface EfashionSnapshot {
  /** Version du format — incrémente quand on change la forme du snapshot. */
  version: 1;
  referenceBase: string;
  /** 1 entrée par couleur liée (= par efashionProductId). Indexé par efashionProductId. */
  variants: EfashionVariantSnapshot[];
  /**
   * Descriptions multilingues du produit. Absent sur les snapshots antérieurs
   * à mai 2026 — la fonction `diffEfashionSnapshots` traite ce cas comme
   * « changement » pour forcer une resync au passage.
   */
  descriptions?: EfashionDescriptions;
  /**
   * Liste des matières (compositions) du produit, triées par id pour avoir
   * un diff stable. Absent sur les snapshots antérieurs à mai 2026.
   */
  compositions?: EfashionCompositionSnapshot[];
  /**
   * Identifiant eFashion de la couleur principale (`main = true` côté eFashion,
   * mappée sur `isPrimary` BJ). Permet de détecter quand l'utilisatrice change
   * sa couleur primaire pour qu'on bascule via `toggleMainProduct`.
   */
  primaryEfashionProductId?: number | null;
}

export interface EfashionDiff {
  /** Liste des variants dont au moins un champ a changé (avant/après). */
  changed: Array<{
    efashionProductId: number;
    fieldsChanged: Array<"visible" | "prix" | "poids">;
    stockChanges: Array<{ taille: string; before: number | null; after: number }>;
    after: EfashionVariantSnapshot;
  }>;
  /** Variants présents avant mais absents après (couleurs déliées). */
  removed: number[];
  /** Variants nouveaux (couleurs liées depuis le dernier snapshot). */
  added: EfashionVariantSnapshot[];
  /** True si au moins une description multilingue a changé. */
  descriptionsChanged: boolean;
  /** True si la liste des matières (compositions) a changé. */
  compositionsChanged: boolean;
  /** True si la couleur principale (main eFashion / isPrimary BJ) a changé. */
  primaryChanged: boolean;
}

/**
 * Compare 2 snapshots et retourne ce qu'il faut envoyer à eFashion.
 * Si `before` est null, tout est considéré comme "added".
 */
export function diffEfashionSnapshots(
  before: EfashionSnapshot | null,
  after: EfashionSnapshot,
): EfashionDiff {
  const result: EfashionDiff = {
    changed: [],
    removed: [],
    added: [],
    descriptionsChanged: false,
    compositionsChanged: false,
    primaryChanged: false,
  };
  if (!before) {
    result.added = [...after.variants];
    result.descriptionsChanged = !!after.descriptions;
    result.compositionsChanged = !!after.compositions;
    // Pas de "before" : le bouton de bascule sera évalué directement contre
    // l'état live d'eFashion par l'updater.
    result.primaryChanged = after.primaryEfashionProductId != null;
    return result;
  }

  const beforeByEfId = new Map(before.variants.map((v) => [v.efashionProductId, v]));
  const afterByEfId = new Map(after.variants.map((v) => [v.efashionProductId, v]));

  for (const v of after.variants) {
    const prev = beforeByEfId.get(v.efashionProductId);
    if (!prev) {
      result.added.push(v);
      continue;
    }
    const fieldsChanged: Array<"visible" | "prix" | "poids"> = [];
    if (prev.visible !== v.visible) fieldsChanged.push("visible");
    if (prev.prix !== v.prix) fieldsChanged.push("prix");
    if (prev.poids !== v.poids) fieldsChanged.push("poids");

    const stockChanges: Array<{ taille: string; before: number | null; after: number }> = [];
    const allTailles = new Set([
      ...Object.keys(prev.stockByTaille),
      ...Object.keys(v.stockByTaille),
    ]);
    for (const taille of allTailles) {
      const b = prev.stockByTaille[taille];
      const a = v.stockByTaille[taille] ?? 0;
      if (b !== a) stockChanges.push({ taille, before: b ?? null, after: a });
    }

    if (fieldsChanged.length > 0 || stockChanges.length > 0) {
      result.changed.push({
        efashionProductId: v.efashionProductId,
        fieldsChanged,
        stockChanges,
        after: v,
      });
    }
  }

  for (const efId of beforeByEfId.keys()) {
    if (!afterByEfId.has(efId)) result.removed.push(efId);
  }

  // Descriptions : on compare **uniquement le FR**. Les autres langues sont
  // dérivées du FR par traduction (moteur eFashion), donc si le FR n'a pas
  // bougé, les traductions ne bougent pas non plus. Si le `before` n'a pas
  // du tout de bloc `descriptions` (snapshots legacy), on considère qu'elles
  // ont changé — synchro de rattrapage idempotente.
  if (after.descriptions) {
    if (!before.descriptions) {
      result.descriptionsChanged = true;
    } else if (before.descriptions.fr !== after.descriptions.fr) {
      result.descriptionsChanged = true;
    }
  }

  // Compositions : on compare la liste triée par id (id, localisationId,
  // percentage). Tout changement de matière, pourcentage ou zone déclenche
  // un re-push de la liste complète (saveProduitCompositions remplace tout).
  if (after.compositions) {
    if (!before.compositions) {
      result.compositionsChanged = true;
    } else if (!sameCompositionsList(before.compositions, after.compositions)) {
      result.compositionsChanged = true;
    }
  }

  // Couleur principale : si l'utilisatrice a déplacé `isPrimary` vers une
  // autre couleur, l'efashionProductId cible diffère du snapshot précédent.
  if (
    after.primaryEfashionProductId != null &&
    before.primaryEfashionProductId !== after.primaryEfashionProductId
  ) {
    result.primaryChanged = true;
  }

  return result;
}

function sameCompositionsList(
  a: EfashionCompositionSnapshot[],
  b: EfashionCompositionSnapshot[],
): boolean {
  if (a.length !== b.length) return false;
  const sortFn = (x: EfashionCompositionSnapshot, y: EfashionCompositionSnapshot) =>
    x.id - y.id || x.localisationId - y.localisationId;
  const sortedA = [...a].sort(sortFn);
  const sortedB = [...b].sort(sortFn);
  for (let i = 0; i < sortedA.length; i++) {
    if (
      sortedA[i].id !== sortedB[i].id ||
      sortedA[i].localisationId !== sortedB[i].localisationId ||
      sortedA[i].percentage !== sortedB[i].percentage
    ) {
      return false;
    }
  }
  return true;
}

export function hasAnyChanges(diff: EfashionDiff): boolean {
  return (
    diff.changed.length > 0 ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.descriptionsChanged ||
    diff.compositionsChanged ||
    diff.primaryChanged
  );
}
