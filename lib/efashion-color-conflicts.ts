/**
 * Détection des conflits de mapping eFashion pour les variantes d'un produit.
 *
 * Miroir de `lib/pfs-color-conflicts.ts`, transposé sur les IDs eFashion qui
 * sont des `number` (biblio couleurs eFashion — ex: 78=Doré, 22=Argent).
 *
 * Règle : 2 couleurs différentes d'un même produit ne peuvent pas partager le
 * même mapping eFashion effectif (= override secondaire s'il existe, sinon
 * mapping principal de la couleur). eFashion crée 1 « produit » par couleur,
 * donc deux couleurs qui pointent sur le même ID = collision côté marketplace.
 *
 * Cette lib est partagée entre :
 *  - le formulaire produit (détection live côté UI)
 *  - les server actions (validation au save)
 *  - les lib efashion-publish/update (filet de sécurité avant envoi)
 */

export interface EfashionVariantColorRefInput {
  key: string;
  /** Identifiant logique de la couleur (Color.id) pour dédupliquer les entrées
   * qui pointent sur la MÊME couleur. À défaut, dédup par `label`. */
  colorId?: string | null;
  /** Libellé humain de la couleur (ex: "Or pâle"). */
  label: string;
  /** Mapping eFashion principal de la couleur (Color.efashionColorId). null si non mappée. */
  principalId: number | null;
  /** Override secondaire (ProductColor.efashionColorIdOverride). null si pas d'override. */
  overrideId: number | null;
}

export interface EfashionColorRefConflictGroup {
  /** L'ID eFashion partagé par toutes ces couleurs. */
  effectiveId: number;
  /** Couleurs en conflit (≥ 2). */
  variants: EfashionVariantColorRefInput[];
}

/**
 * Calcule le mapping eFashion effectif : override secondaire en priorité,
 * sinon mapping principal de la couleur.
 */
export function effectiveEfashionColorId(input: {
  principalId: number | null;
  overrideId: number | null;
}): number | null {
  if (input.overrideId != null) return input.overrideId;
  return input.principalId;
}

/**
 * Détecte tous les groupes de variantes qui partagent le même mapping eFashion
 * effectif. Variantes sans mapping (principal=null ET override=null) ignorées.
 *
 * Un conflit n'existe qu'entre **deux couleurs différentes** qui pointent sur
 * la même cible eFashion : deux variantes de la même couleur sur la même cible
 * = pas un conflit (eFashion reçoit une seule couleur de toute façon).
 */
export function detectEfashionColorConflicts(
  variants: EfashionVariantColorRefInput[],
): EfashionColorRefConflictGroup[] {
  const buckets = new Map<number, EfashionVariantColorRefInput[]>();
  for (const v of variants) {
    const id = effectiveEfashionColorId(v);
    if (id == null) continue;
    const arr = buckets.get(id);
    if (arr) {
      arr.push(v);
    } else {
      buckets.set(id, [v]);
    }
  }
  const conflicts: EfashionColorRefConflictGroup[] = [];
  for (const [id, arr] of buckets.entries()) {
    const seen = new Set<string>();
    const uniqueByColor: EfashionVariantColorRefInput[] = [];
    for (const v of arr) {
      const dedupKey = (v.colorId?.trim() || v.label.trim()).toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      uniqueByColor.push(v);
    }
    if (uniqueByColor.length >= 2) {
      conflicts.push({ effectiveId: id, variants: uniqueByColor });
    }
  }
  return conflicts;
}

/**
 * Vérifie qu'un override secondaire est valide : non-null ET différent du
 * mapping principal de la couleur. Retourne `null` si valide, sinon message.
 */
export function validateEfashionOverrideAgainstPrincipal(
  overrideId: number | null,
  principalId: number | null,
): string | null {
  if (overrideId == null) return null;
  if (principalId != null && overrideId === principalId) {
    return "Le mapping eFashion secondaire doit être différent du mapping principal de la couleur.";
  }
  return null;
}

export interface ValidateEfashionOverridesColorInput {
  colorId: string | null;
  efashionColorIdOverride?: number | null;
  packLines?: { colorId: string; efashionColorIdOverride?: number | null }[];
}

/**
 * Valide qu'aucun override eFashion d'un input couleur n'est identique au
 * mapping principal de cette même couleur. Vérifie aussi les lignes de pack.
 * Throw à la première violation.
 */
export function validateEfashionOverridesNotMatchingPrincipal(
  colors: ValidateEfashionOverridesColorInput[],
  principalIdByColorId: Map<string, number | null>,
): void {
  for (const c of colors) {
    if (c.colorId && c.efashionColorIdOverride != null) {
      const principal = principalIdByColorId.get(c.colorId) ?? null;
      const err = validateEfashionOverrideAgainstPrincipal(
        c.efashionColorIdOverride,
        principal,
      );
      if (err) throw new Error(err);
    }
    if (c.packLines) {
      for (const pl of c.packLines) {
        if (pl.colorId && pl.efashionColorIdOverride != null) {
          const principal = principalIdByColorId.get(pl.colorId) ?? null;
          const err = validateEfashionOverrideAgainstPrincipal(
            pl.efashionColorIdOverride,
            principal,
          );
          if (err) throw new Error(err);
        }
      }
    }
  }
}

export function formatEfashionConflictsMessage(
  conflicts: EfashionColorRefConflictGroup[],
): string {
  if (conflicts.length === 0) return "";
  const lines = conflicts.map((c) => {
    const labels = c.variants.map((v) => `« ${v.label} »`).join(", ");
    return `${labels} → ID eFashion ${c.effectiveId}`;
  });
  return `Conflit de mapping eFashion : ${lines.join(" ; ")}.`;
}

/**
 * Type minimal d'une variante chargée depuis la BDD, utilisé par les filets
 * de sécurité côté publication/update eFashion.
 */
export interface DbVariantForEfashionConflictCheck {
  color: { id?: string; name: string; efashionColorId: number | null } | null;
  efashionColorIdOverride: number | null;
  packLines: {
    color: { id?: string; name: string; efashionColorId: number | null };
    efashionColorIdOverride: number | null;
  }[];
}

export function detectEfashionConflictsForDbProduct(
  variants: DbVariantForEfashionConflictCheck[],
): EfashionColorRefConflictGroup[] {
  const items: EfashionVariantColorRefInput[] = [];
  let idx = 0;
  for (const v of variants) {
    if (v.color) {
      items.push({
        key: `v${idx}`,
        colorId: v.color.id ?? null,
        label: v.color.name,
        principalId: v.color.efashionColorId,
        overrideId: v.efashionColorIdOverride ?? null,
      });
    }
    for (const pl of v.packLines) {
      items.push({
        key: `v${idx}-pl${pl.color.name}`,
        colorId: pl.color.id ?? null,
        label: pl.color.name,
        principalId: pl.color.efashionColorId,
        overrideId: pl.efashionColorIdOverride ?? null,
      });
    }
    idx += 1;
  }
  return detectEfashionColorConflicts(items);
}

/**
 * Throw une erreur claire si un produit chargé en BDD contient des conflits
 * de mapping eFashion. À appeler en haut de chaque opération eFashion.
 */
export function assertNoEfashionColorConflicts(
  variants: DbVariantForEfashionConflictCheck[],
): void {
  const conflicts = detectEfashionConflictsForDbProduct(variants);
  if (conflicts.length > 0) {
    throw new Error(
      formatEfashionConflictsMessage(conflicts) +
        " Définissez un mapping eFashion secondaire différent depuis le formulaire produit.",
    );
  }
}
