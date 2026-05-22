/**
 * Helpers pour résoudre un ID eFashion en libellé lisible (catégorie, couleur,
 * composition, pays, saison, taille). Utilisé par les pages admin pour afficher
 * la valeur correspondante au lieu de l'ID brut dans les tableaux.
 *
 * Le résolveur s'appuie sur les annexes déjà cachées 60 min via
 * `getEfashionAnnexes()` — aucune requête supplémentaire à eFashion.
 *
 * Tolérant aux erreurs : si eFashion n'est pas joignable / pas configuré, on
 * retourne un map vide ; les pages affichent alors l'ID brut comme avant.
 */

import { getEfashionAnnexes, type EfashionAnnexes } from "@/lib/efashion-annexes";
import { getCachedEfashionEnabled } from "@/lib/cached-data";

export interface EfashionLabelMaps {
  categories: Map<number, string>;
  colors: Map<number, string>;
  compositions: Map<number, string>;
  provenances: Map<number, string>;
  collections: Map<number, string>;
  declinaisons: Map<number, { titre: string; sizes: Map<string, string> }>;
}

/** Fabrique des `Map` de résolution depuis les annexes eFashion. */
function buildLabelMaps(annexes: EfashionAnnexes): EfashionLabelMaps {
  const categories = new Map<number, string>();
  // Une catégorie peut apparaître sous plusieurs parents → garde le 1er path
  // rencontré, suffisant pour affichage.
  for (const c of annexes.categories) {
    if (!categories.has(c.id)) categories.set(c.id, c.path);
  }

  const colors = new Map<number, string>();
  for (const c of annexes.colors) {
    colors.set(c.id, c.fr || c.en);
  }

  const compositions = new Map<number, string>();
  for (const c of annexes.compositions) {
    compositions.set(c.id, c.label);
  }

  const provenances = new Map<number, string>();
  for (const p of annexes.provenances) {
    provenances.set(p.id, p.libelle);
  }

  const collections = new Map<number, string>();
  for (const c of annexes.collections) {
    collections.set(c.id, c.label);
  }

  const declinaisons = new Map<number, { titre: string; sizes: Map<string, string> }>();
  for (const d of annexes.declinaisons) {
    const sizes = new Map<string, string>();
    for (const s of d.sizes) sizes.set(s.field, s.value);
    declinaisons.set(d.id, { titre: d.titre, sizes });
  }

  return { categories, colors, compositions, provenances, collections, declinaisons };
}

/** Maps vides (utilisé en fallback quand eFashion est indisponible). */
function emptyLabelMaps(): EfashionLabelMaps {
  return {
    categories: new Map(),
    colors: new Map(),
    compositions: new Map(),
    provenances: new Map(),
    collections: new Map(),
    declinaisons: new Map(),
  };
}

/**
 * Charge les annexes et retourne les maps de résolution. Si eFashion est
 * indisponible ou pas configuré, retourne des maps vides (les pages afficheront
 * l'ID brut comme avant — pas de crash).
 */
export async function getEfashionLabelMaps(): Promise<EfashionLabelMaps> {
  try {
    // Skip si eFashion désactivé — évite un fetch inutile.
    const enabled = await getCachedEfashionEnabled();
    if (!enabled) return emptyLabelMaps();
    const annexes = await getEfashionAnnexes();
    return buildLabelMaps(annexes);
  } catch {
    return emptyLabelMaps();
  }
}

/** Résout un ID catégorie eFashion en path lisible ("Femme > Bijoux > Bracelets"). */
export function resolveCategoryLabel(maps: EfashionLabelMaps, id: number | null | undefined): string | null {
  if (id == null) return null;
  return maps.categories.get(id) ?? null;
}

export function resolveColorLabel(maps: EfashionLabelMaps, id: number | null | undefined): string | null {
  if (id == null) return null;
  return maps.colors.get(id) ?? null;
}

export function resolveCompositionLabel(maps: EfashionLabelMaps, id: number | null | undefined): string | null {
  if (id == null) return null;
  return maps.compositions.get(id) ?? null;
}

export function resolveProvenanceLabel(maps: EfashionLabelMaps, id: number | null | undefined): string | null {
  if (id == null) return null;
  return maps.provenances.get(id) ?? null;
}

export function resolveCollectionLabel(maps: EfashionLabelMaps, id: number | null | undefined): string | null {
  if (id == null) return null;
  return maps.collections.get(id) ?? null;
}

/** Résout une déclinaison + un field en libellé "Bagues / taille_50". */
export function resolveDeclinaisonLabel(
  maps: EfashionLabelMaps,
  declinaisonId: number | null | undefined,
  field: string | null | undefined,
): string | null {
  if (declinaisonId == null) return null;
  const decl = maps.declinaisons.get(declinaisonId);
  if (!decl) return null;
  if (!field) return decl.titre;
  const sizeValue = decl.sizes.get(field);
  return sizeValue ? `${decl.titre} / ${sizeValue}` : `${decl.titre} / ${field}`;
}
