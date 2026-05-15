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
  /**
   * Identifiant logique de la couleur (Color.id). Sert à dédupliquer les
   * entrées qui pointent sur la MÊME couleur du produit : si plusieurs
   * variantes utilisent la même couleur (ex : 2 tailles différentes de la
   * couleur « Doré »), elles ne comptent que comme une seule "couleur
   * produit" — pas comme un conflit. À défaut, la dédup retombe sur `label`.
   */
  colorId?: string | null;
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
 *
 * Règle : un conflit n'existe qu'entre **deux couleurs différentes** qui
 * pointent sur la même cible PFS. Si deux variantes utilisent la même couleur
 * (même `colorId`, ou à défaut même `label`), elles ne comptent que comme une
 * seule "couleur produit" — c'est juste la même couleur réutilisée et PFS la
 * recevra de toute façon une seule fois.
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
    // Dédupe par couleur logique : 2 variantes de la même couleur sur la même
    // cible PFS, ce n'est pas un conflit.
    const seen = new Set<string>();
    const uniqueByColor: VariantColorRefInput[] = [];
    for (const v of arr) {
      const dedupKey = (v.colorId?.trim() || v.label.trim()).toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      uniqueByColor.push(v);
    }
    if (uniqueByColor.length >= 2) {
      conflicts.push({ effectiveRef: ref, variants: uniqueByColor });
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
  color: { id?: string; name: string; pfsColorRef: string | null } | null;
  pfsColorRefOverride: string | null;
  packLines: {
    color: { id?: string; name: string; pfsColorRef: string | null };
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
        colorId: v.color.id ?? null,
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
        colorId: pl.color.id ?? null,
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
