/**
 * Détection des conflits de nom couleur pour les marketplaces à texte libre
 * (Ankorstore, Faire).
 *
 * Règle : 2 couleurs différentes du même produit ne peuvent pas être envoyées
 * avec le même nom effectif (comparaison insensible à la casse et aux espaces
 * de bord), sinon la marketplace recevrait deux fois « Doré » et rejetterait
 * la seconde variante — ou pire, écraserait la première.
 *
 * Nom effectif = override secondaire s'il est renseigné, sinon nom de la
 * couleur BJ.
 */

export interface FreeTextColorInput {
  /** Identifiant local pour reporter le conflit (ex: dbId, slot). */
  key: string;
  /**
   * Identifiant logique de la couleur BJ. Deux entrées avec le même colorId ne
   * comptent que pour une seule "couleur produit" (pas un conflit — c'est juste
   * la même couleur réutilisée sur plusieurs variantes/tailles).
   */
  colorId?: string | null;
  /** Nom de la couleur BJ (fallback si pas d'override). */
  colorName: string;
  /** Override secondaire saisi par l'admin. null / vide = pas d'override. */
  overrideName: string | null;
}

export interface FreeTextColorConflictGroup {
  /** Le nom effectif partagé (forme normalisée : trim + lowercase). */
  normalizedName: string;
  /** Un exemple lisible du nom (première occurrence, non normalisée). */
  displayName: string;
  /** Entrées en conflit (≥ 2 couleurs distinctes). */
  entries: FreeTextColorInput[];
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Retourne le nom effectif d'une entrée (override si non-vide, sinon colorName).
 * Retourne `null` si les deux sont vides.
 */
export function effectiveFreeTextName(input: {
  colorName: string;
  overrideName: string | null;
}): string | null {
  const override = input.overrideName?.trim() || null;
  if (override) return override;
  const name = input.colorName?.trim() || null;
  return name;
}

/**
 * Détecte les groupes de couleurs qui partagent le même nom effectif
 * (comparaison case-insensitive). Deux variantes/lignes qui pointent sur la
 * même couleur BJ (même colorId) ne comptent que comme une seule couleur
 * produit — ce n'est pas un conflit.
 */
export function detectFreeTextColorConflicts(
  entries: FreeTextColorInput[],
): FreeTextColorConflictGroup[] {
  const buckets = new Map<string, { display: string; items: FreeTextColorInput[] }>();

  for (const e of entries) {
    const eff = effectiveFreeTextName(e);
    if (!eff) continue;
    const norm = normalize(eff);
    const bucket = buckets.get(norm);
    if (bucket) {
      bucket.items.push(e);
    } else {
      buckets.set(norm, { display: eff, items: [e] });
    }
  }

  const conflicts: FreeTextColorConflictGroup[] = [];
  for (const [normalized, { display, items }] of buckets.entries()) {
    // Dédupe par couleur logique — deux variantes de la même couleur BJ ne
    // sont pas un conflit (elles envoient forcément le même nom).
    const seen = new Set<string>();
    const uniqueByColor: FreeTextColorInput[] = [];
    for (const e of items) {
      const dedupKey = (e.colorId?.trim() || normalize(e.colorName));
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      uniqueByColor.push(e);
    }
    if (uniqueByColor.length >= 2) {
      conflicts.push({ normalizedName: normalized, displayName: display, entries: uniqueByColor });
    }
  }
  return conflicts;
}
