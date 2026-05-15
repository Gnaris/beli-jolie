/**
 * Détection des conflits de mapping PFS pour les variantes d'un produit.
 *
 * Règle : 2 variantes d'un même produit ne peuvent pas avoir le même mapping
 * PFS effectif (= override secondaire s'il existe, sinon mapping principal de
 * la couleur). Sinon PFS recevrait deux fois la même couleur et planterait.
 *
 * Cette logique est partagée entre :
 *  - le formulaire produit (détection live côté UI)
 *  - les server actions (validation au save)
 *  - les lib pfs-publish/update/refresh (filet de sécurité avant envoi)
 */

export interface VariantColorRefInput {
  /** Identifiant local pour reporter le conflit (ex: dbId, slot, ou index). */
  key: string;
  /** Libellé humain de la variante (ex: "Or pâle"). Utilisé dans les messages. */
  label: string;
  /** Mapping PFS principal de la couleur (Color.pfsColorRef). null si non mappée. */
  principalRef: string | null;
  /** Override secondaire (ProductColor.pfsColorRefOverride). null si pas d'override. */
  overrideRef: string | null;
}

export interface ColorRefConflictGroup {
  /** Le mapping PFS partagé par toutes ces variantes. */
  effectiveRef: string;
  /** Variantes en conflit (≥ 2). */
  variants: VariantColorRefInput[];
}

/**
 * Calcule le mapping PFS effectif d'une variante : override secondaire en
 * priorité, sinon mapping principal de la couleur.
 */
export function effectivePfsColorRef(input: {
  principalRef: string | null;
  overrideRef: string | null;
}): string | null {
  const override = input.overrideRef?.trim() || null;
  if (override) return override;
  const principal = input.principalRef?.trim() || null;
  return principal;
}

/**
 * Détecte tous les groupes de variantes qui partagent le même mapping PFS
 * effectif. Variantes sans mapping (principal=null ET override=null) ignorées.
 */
export function detectPfsColorConflicts(
  variants: VariantColorRefInput[],
): ColorRefConflictGroup[] {
  const buckets = new Map<string, VariantColorRefInput[]>();
  for (const v of variants) {
    const ref = effectivePfsColorRef(v);
    if (!ref) continue;
    const arr = buckets.get(ref);
    if (arr) {
      arr.push(v);
    } else {
      buckets.set(ref, [v]);
    }
  }
  const conflicts: ColorRefConflictGroup[] = [];
  for (const [ref, arr] of buckets.entries()) {
    if (arr.length >= 2) {
      conflicts.push({ effectiveRef: ref, variants: arr });
    }
  }
  return conflicts;
}

/**
 * Vérifie qu'un override secondaire est valide : non vide ET différent du
 * mapping principal de la couleur. Retourne `null` si valide, ou un message
 * d'erreur sinon.
 */
export function validateOverrideAgainstPrincipal(
  overrideRef: string | null,
  principalRef: string | null,
): string | null {
  const override = overrideRef?.trim() || null;
  if (!override) return null; // pas d'override = OK
  const principal = principalRef?.trim() || null;
  if (principal && override === principal) {
    return "Le mapping secondaire doit être différent du mapping principal de la couleur.";
  }
  return null;
}

/**
 * Valide qu'aucun override secondaire d'un input couleur n'est identique au
 * mapping principal de cette même couleur. Vérifie aussi les lignes de pack.
 *
 * `principalRefByColorId` doit fournir le pfsColorRef de toutes les couleurs
 * référencées dans `colors` (et leurs packLines). Une couleur sans mapping
 * principal (null) reste compatible avec un override.
 *
 * Throw une erreur explicite à la première violation. Sinon no-op.
 */
export interface ValidateOverridesColorInput {
  colorId: string | null;
  pfsColorRefOverride?: string | null;
  packLines?: { colorId: string; pfsColorRefOverride?: string | null }[];
}

export function validateOverridesNotMatchingPrincipal(
  colors: ValidateOverridesColorInput[],
  principalRefByColorId: Map<string, string | null>,
): void {
  for (const c of colors) {
    if (c.colorId && c.pfsColorRefOverride) {
      const principal = principalRefByColorId.get(c.colorId) ?? null;
      const err = validateOverrideAgainstPrincipal(c.pfsColorRefOverride, principal);
      if (err) throw new Error(err);
    }
    if (c.packLines) {
      for (const pl of c.packLines) {
        if (pl.colorId && pl.pfsColorRefOverride) {
          const principal = principalRefByColorId.get(pl.colorId) ?? null;
          const err = validateOverrideAgainstPrincipal(pl.pfsColorRefOverride, principal);
          if (err) throw new Error(err);
        }
      }
    }
  }
}

/**
 * Construit un message d'erreur lisible listant tous les conflits.
 */
export function formatConflictsMessage(conflicts: ColorRefConflictGroup[]): string {
  if (conflicts.length === 0) return "";
  const lines = conflicts.map((c) => {
    const labels = c.variants.map((v) => `« ${v.label} »`).join(", ");
    return `${labels} → mapping PFS « ${c.effectiveRef} »`;
  });
  return `Conflit de mapping PFS : ${lines.join(" ; ")}.`;
}

/**
 * Type minimal d'une variante chargée depuis la BDD (compatible avec les
 * `FullVariant` locaux des fichiers pfs-publish/update/refresh).
 */
export interface DbVariantForConflictCheck {
  color: { name: string; pfsColorRef: string | null } | null;
  pfsColorRefOverride: string | null;
  packLines: {
    color: { name: string; pfsColorRef: string | null };
    pfsColorRefOverride: string | null;
  }[];
}

/**
 * Détecte les conflits sur un produit BDD (variantes UNIT/PACK + lignes de pack).
 * Pour chaque variante UNIT, on prend son effective ref. Pour chaque pack, on
 * regarde les lignes (ou la couleur unique pour mono-couleur).
 *
 * Pour les conflits **inter-variantes** (deux variantes de produit qui
 * pointent sur le même mapping), on regroupe les variantes top-level + les
 * lignes des packs ensemble car PFS reçoit tout dans le même produit.
 */
export function detectPfsConflictsForDbProduct(
  variants: DbVariantForConflictCheck[],
  colorLabelToRefMap?: Map<string, string>,
): ColorRefConflictGroup[] {
  const items: VariantColorRefInput[] = [];
  let idx = 0;
  for (const v of variants) {
    if (v.color) {
      const principal = v.color.pfsColorRef
        ?? colorLabelToRefMap?.get(v.color.name)
        ?? v.color.name;
      items.push({
        key: `v${idx}`,
        label: v.color.name,
        principalRef: principal,
        overrideRef: v.pfsColorRefOverride ?? null,
      });
    }
    for (const pl of v.packLines) {
      const principal = pl.color.pfsColorRef
        ?? colorLabelToRefMap?.get(pl.color.name)
        ?? pl.color.name;
      items.push({
        key: `v${idx}-pl${pl.color.name}`,
        label: pl.color.name,
        principalRef: principal,
        overrideRef: pl.pfsColorRefOverride ?? null,
      });
    }
    idx += 1;
  }
  return detectPfsColorConflicts(items);
}

/**
 * Throw une erreur claire si un produit chargé en BDD contient des conflits
 * de mapping PFS. À appeler en haut de chaque opération PFS (publish, update,
 * refresh) pour bloquer l'envoi.
 */
export function assertNoPfsColorConflicts(
  variants: DbVariantForConflictCheck[],
  colorLabelToRefMap?: Map<string, string>,
): void {
  const conflicts = detectPfsConflictsForDbProduct(variants, colorLabelToRefMap);
  if (conflicts.length > 0) {
    throw new Error(
      formatConflictsMessage(conflicts) +
        " Définissez un mapping secondaire différent depuis le formulaire produit.",
    );
  }
}
