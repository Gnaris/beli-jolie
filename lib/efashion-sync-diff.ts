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

export interface EfashionSnapshot {
  /** Version du format — incrémente quand on change la forme du snapshot. */
  version: 1;
  referenceBase: string;
  /** 1 entrée par couleur liée (= par efashionProductId). Indexé par efashionProductId. */
  variants: EfashionVariantSnapshot[];
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
}

/**
 * Compare 2 snapshots et retourne ce qu'il faut envoyer à eFashion.
 * Si `before` est null, tout est considéré comme "added".
 */
export function diffEfashionSnapshots(
  before: EfashionSnapshot | null,
  after: EfashionSnapshot,
): EfashionDiff {
  const result: EfashionDiff = { changed: [], removed: [], added: [] };
  if (!before) {
    result.added = [...after.variants];
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
  return result;
}

export function hasAnyChanges(diff: EfashionDiff): boolean {
  return diff.changed.length > 0 || diff.added.length > 0 || diff.removed.length > 0;
}
