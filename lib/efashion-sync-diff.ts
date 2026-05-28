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
  /**
   * Images BJ de cette variante, triées par `order` croissant. `order=0` =
   * photo principale eFashion (`c.jpg`), `order=N` = `z-N.jpg`. Absent sur
   * les snapshots antérieurs à mai 2026 — la fonction `diffEfashionSnapshots`
   * traite ce cas comme « changement » pour forcer une resync.
   */
  images?: Array<{ dbPath: string; order: number }>;
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
  /**
   * id_declinaison eFashion du groupe — partagé par toutes les couleurs du
   * même produit (eFashion impose un seul « moule de tailles » par groupe).
   * Permet de détecter quand l'utilisatrice ajoute/retire des tailles BJ et
   * qu'il faut basculer le groupe vers une autre déclinaison côté eFashion
   * (sinon les stocks sur les nouvelles tailles tombent dans le vide).
   * Absent sur les snapshots antérieurs au 2026-05-28.
   */
  declinaisonId?: number | null;
}

export interface EfashionDiff {
  /** Liste des variants dont au moins un champ a changé (avant/après). */
  changed: Array<{
    efashionProductId: number;
    fieldsChanged: Array<"visible" | "prix" | "poids">;
    stockChanges: Array<{ taille: string; before: number | null; after: number }>;
    /**
     * True si la liste d'images (paths ou ordre) a changé par rapport au
     * snapshot précédent. Quand vrai, l'updater doit purger les photos
     * eFashion de cette variante et ré-uploader la nouvelle liste.
     */
    imagesChanged: boolean;
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
  /**
   * True si l'id_declinaison cible (= « moule de tailles » eFashion) diffère
   * de celui du snapshot précédent. Typiquement déclenché quand l'utilisatrice
   * ajoute/retire une taille au produit BJ.
   */
  declinaisonChanged: boolean;
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
    declinaisonChanged: false,
  };
  if (!before) {
    result.added = [...after.variants];
    result.descriptionsChanged = !!after.descriptions;
    result.compositionsChanged = !!after.compositions;
    // Pas de "before" : le bouton de bascule sera évalué directement contre
    // l'état live d'eFashion par l'updater.
    result.primaryChanged = after.primaryEfashionProductId != null;
    result.declinaisonChanged = after.declinaisonId != null;
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

    // Détection de changement d'images : par défaut, considérer le snapshot
    // legacy (sans `images`) comme « inchangé » côté images — sinon chaque
    // sync existante repousserait toutes les photos sans raison. La 1ʳᵉ sync
    // après l'ajout d'images dans le snapshot écrit `images` côté `after`,
    // donc le diff devient calculable normalement aux runs suivants.
    let imagesChanged = false;
    if (v.images !== undefined) {
      if (prev.images === undefined) {
        // Snapshot legacy : pas de référence côté avant. On ne repousse PAS
        // les photos automatiquement (cf. raisonnement ci-dessus). L'utilisatrice
        // peut forcer via `forceFullSync` si elle veut le rattrapage.
        imagesChanged = false;
      } else {
        imagesChanged = !sameImagesList(prev.images, v.images);
      }
    }

    if (fieldsChanged.length > 0 || stockChanges.length > 0 || imagesChanged) {
      result.changed.push({
        efashionProductId: v.efashionProductId,
        fieldsChanged,
        stockChanges,
        imagesChanged,
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

  // Déclinaison eFashion (« moule de tailles » du groupe). On déclenche un
  // changement si :
  //   - la cible est définie ET le before n'avait pas d'id (snapshot legacy →
  //     on remonte la valeur pour qu'elle soit poussée si différente du live),
  //   - OU les 2 sont définis mais différents (l'utilisatrice a ajouté/retiré
  //     une taille au produit BJ).
  if (after.declinaisonId != null) {
    if (before.declinaisonId == null || before.declinaisonId !== after.declinaisonId) {
      result.declinaisonChanged = true;
    }
  }

  return result;
}

/**
 * Compare deux listes d'images (paths + order). Stable au tri : on compare
 * dans l'ordre `order` croissant. Tout changement de path ou de position
 * dans la séquence est considéré comme un diff.
 */
function sameImagesList(
  a: Array<{ dbPath: string; order: number }>,
  b: Array<{ dbPath: string; order: number }>,
): boolean {
  if (a.length !== b.length) return false;
  const sortFn = (x: { order: number }, y: { order: number }) => x.order - y.order;
  const sortedA = [...a].sort(sortFn);
  const sortedB = [...b].sort(sortFn);
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].dbPath !== sortedB[i].dbPath || sortedA[i].order !== sortedB[i].order) {
      return false;
    }
  }
  return true;
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
    diff.primaryChanged ||
    diff.declinaisonChanged
  );
}
