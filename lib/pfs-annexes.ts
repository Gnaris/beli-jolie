/**
 * Annexes PFS — listes d'options pour l'UI de mappings, alimentées en LIVE
 * via l'API PFS (anciennement extraites du template Excel).
 *
 * Mêmes exports que `lib/marketplace-excel/pfs-annexes.ts` pour permettre une
 * substitution sans toucher les consommateurs. Cache `unstable_cache` (60min)
 * pour éviter de spammer PFS à chaque ouverture de la page mappings.
 */

import { unstable_cache } from "next/cache";
import {
  pfsGetGenders,
  pfsGetFamilies,
  pfsGetCategories,
  pfsGetColors,
  pfsGetCompositions,
  pfsGetCountries,
  pfsGetSizes,
  pfsGetCollections,
} from "@/lib/pfs-api-write";
import { logger } from "@/lib/logger";

export type PfsGender = "Femme" | "Homme" | "Enfant" | "Lifestyle_et_Plus";

export interface PfsFamilyOption {
  gender: PfsGender;
  /** Label PFS (français) — ce que l'admin sélectionne dans le formulaire. */
  family: string;
}

export interface PfsCategoryOption {
  gender: PfsGender;
  family: string;
  category: string;
}

export interface PfsSeasonOption {
  /** Code interne PFS — ex: "PE2026", "AH2025". Utilisé en valeur stockée. */
  reference: string;
  /** Label affiché à l'admin — ex: "PE2026 — Printemps/Été 2026". */
  label: string;
}

export interface PfsAnnexes {
  families: PfsFamilyOption[];
  categories: PfsCategoryOption[];
  colors: string[];
  compositions: string[];
  countries: string[];
  sizes: string[];
  /** Saisons réelles côté PFS — vient remplacer la génération [annéeN-1, annéeN+1]. */
  seasons: PfsSeasonOption[];
}

const GENDER_REF_TO_FR: Record<string, PfsGender> = {
  WOMAN: "Femme",
  MAN: "Homme",
  KID: "Enfant",
  SUPPLIES: "Lifestyle_et_Plus",
};

function pickFr(labels: Record<string, string> | undefined | null, fallback = ""): string {
  if (!labels) return fallback;
  return labels.fr ?? labels.en ?? Object.values(labels)[0] ?? fallback;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.trim()))).sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base" }),
  );
}

async function loadFresh(): Promise<PfsAnnexes> {
  // Toutes les requêtes en parallèle pour minimiser le temps total.
  const [genders, families, categories, colors, compositions, countries, sizes, collections] =
    await Promise.all([
      pfsGetGenders().catch((e) => {
        logger.warn("[PFS Annexes] genders failed", { error: String(e) });
        return [];
      }),
      pfsGetFamilies().catch((e) => {
        logger.warn("[PFS Annexes] families failed", { error: String(e) });
        return [];
      }),
      pfsGetCategories().catch((e) => {
        logger.warn("[PFS Annexes] categories failed", { error: String(e) });
        return [];
      }),
      pfsGetColors().catch((e) => {
        logger.warn("[PFS Annexes] colors failed", { error: String(e) });
        return [];
      }),
      pfsGetCompositions().catch((e) => {
        logger.warn("[PFS Annexes] compositions failed", { error: String(e) });
        return [];
      }),
      pfsGetCountries().catch((e) => {
        logger.warn("[PFS Annexes] countries failed", { error: String(e) });
        return [];
      }),
      pfsGetSizes().catch((e) => {
        logger.warn("[PFS Annexes] sizes failed", { error: String(e) });
        return [];
      }),
      pfsGetCollections().catch((e) => {
        logger.warn("[PFS Annexes] collections failed", { error: String(e) });
        return [];
      }),
    ]);

  // Construit un index id→label pour les familles (les catégories n'ont qu'un
  // string ou un objet { id } selon les retours, donc on a besoin de retrouver
  // le label par ID).
  const familyIdToLabel = new Map<string, string>();
  const familyIdToGender = new Map<string, PfsGender>();
  for (const f of families) {
    const label = pickFr(f.labels, f.id);
    const fr = GENDER_REF_TO_FR[f.gender] ?? null;
    if (fr) {
      familyIdToLabel.set(f.id, label);
      familyIdToGender.set(f.id, fr);
    }
  }

  const familyOptions: PfsFamilyOption[] = [];
  for (const [id, family] of familyIdToLabel.entries()) {
    const gender = familyIdToGender.get(id);
    if (gender) familyOptions.push({ gender, family });
  }

  const categoryOptions: PfsCategoryOption[] = [];
  for (const c of categories) {
    let familyId: string | null = null;
    if (typeof c.family === "string") familyId = c.family;
    else if (c.family && typeof c.family === "object" && "id" in c.family) familyId = (c.family as { id: string }).id;

    const familyLabel = familyId ? familyIdToLabel.get(familyId) : null;
    const genderRef = c.gender ?? (familyId ? familyIdToGender.get(familyId) : null);
    const gender = typeof genderRef === "string" ? GENDER_REF_TO_FR[genderRef] ?? (genderRef as PfsGender) : null;

    if (!familyLabel || !gender) continue;
    categoryOptions.push({
      gender,
      family: familyLabel,
      category: pickFr(c.labels, c.id),
    });
  }

  // Saisons : on garde le code (reference) comme valeur stockée, et on
  // construit un label lisible style "PE2026 — Printemps/Été 2026".
  const seasonOptions: PfsSeasonOption[] = collections
    .map((c) => {
      const ref = c.reference;
      if (!ref) return null;
      const label = pickFr(c.labels, ref);
      let displayLabel: string;
      if (label && label !== ref) {
        displayLabel = `${ref} — ${label}`;
      } else {
        const m = /^(PE|AH)(\d{4})$/.exec(ref);
        if (m) {
          const tag = m[1] === "PE" ? "Printemps/Été" : "Automne/Hiver";
          displayLabel = `${ref} — ${tag} ${m[2]}`;
        } else {
          displayLabel = ref;
        }
      }
      return { reference: ref, label: displayLabel };
    })
    .filter((v): v is PfsSeasonOption => v !== null)
    .sort((a, b) => b.reference.localeCompare(a.reference));

  return {
    families: familyOptions,
    categories: categoryOptions,
    colors: uniqueSorted(colors.map((c) => pickFr(c.labels, c.reference))),
    compositions: uniqueSorted(compositions.map((c) => pickFr(c.labels, c.reference))),
    countries: uniqueSorted(countries.map((c) => pickFr(c.labels, c.reference))),
    sizes: uniqueSorted(sizes.map((s) => s.reference)),
    seasons: seasonOptions,
  };
}

const cachedAnnexes = unstable_cache(loadFresh, ["pfs-annexes-v1"], {
  revalidate: 3600, // 1h
  tags: ["pfs-annexes"],
});

export async function getPfsAnnexes(): Promise<PfsAnnexes> {
  return cachedAnnexes();
}

/** Pour les tests : pas de cache. */
export async function getPfsAnnexesFresh(): Promise<PfsAnnexes> {
  return loadFresh();
}
