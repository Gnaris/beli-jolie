/**
 * Enrichit les produits de l'export PFS avec des traductions à la volée
 * (EN / ES / DE / IT) pour le nom et la description.
 *
 * IMPORTANT : ne touche PAS à la base de données. Les traductions sont ajoutées
 * uniquement à la copie en mémoire des produits, juste avant la génération de
 * l'Excel. Quand l'export est terminé, ces traductions ne sont plus utilisées.
 *
 * Pourquoi : le site est configuré en FR + EN, donc la base ne contient que
 * ces 2 langues. Mais l'Excel PFS a 5 colonnes de traductions (FR, EN, ES,
 * DE, IT). On comble ES/DE/IT à l'export en appelant l'API PFS — c'est gratuit
 * et lié au compte PFS de la cliente.
 *
 * Optimisation : une seule requête PFS par texte renvoie toutes les langues
 * d'un coup, donc 2 appels par produit (1 pour le nom + 1 pour la description),
 * pas 8. Les produits sont traités en parallèle par lots pour éviter de
 * saturer PFS.
 */

import type { ExportProduct } from "./types";
import { translateToAllLocales } from "@/lib/pfs-translate";

/** Locales cibles dans l'export PFS. FR n'est pas une "traduction" (c'est la source). */
const PFS_EXPORT_LOCALES = ["en", "es", "de", "it"] as const;

/** Nombre de produits traduits en parallèle. Au-delà, PFS peut throttler. */
const PARALLEL_BATCH_SIZE = 5;

/**
 * Retourne une **nouvelle liste** de produits enrichie avec les traductions
 * manquantes. Ne modifie pas les objets d'entrée.
 *
 * Les traductions déjà présentes en base (typiquement EN) sont conservées.
 * On ne traduit à la volée que les locales manquantes ET seulement le champ
 * (name ou description) qui manque.
 */
export async function enrichProductsWithPfsTranslations(
  products: ExportProduct[],
): Promise<ExportProduct[]> {
  // Découpe en lots parallèles pour ne pas saturer PFS.
  const out: ExportProduct[] = new Array(products.length);
  for (let i = 0; i < products.length; i += PARALLEL_BATCH_SIZE) {
    const batch = products.slice(i, i + PARALLEL_BATCH_SIZE);
    const enriched = await Promise.all(batch.map((p) => enrichOne(p)));
    for (let j = 0; j < enriched.length; j++) {
      out[i + j] = enriched[j];
    }
  }
  return out;
}

async function enrichOne(p: ExportProduct): Promise<ExportProduct> {
  // Détermine pour chaque locale ce qu'il manque (nom et/ou description).
  const needs: Record<string, { name: boolean; description: boolean }> = {};
  let anyNameMissing = false;
  let anyDescMissing = false;

  for (const locale of PFS_EXPORT_LOCALES) {
    const existing = p.translations[locale];
    const nameMissing = !existing?.name?.trim();
    const descMissing = !!p.description?.trim() && !existing?.description?.trim();
    if (nameMissing || descMissing) {
      needs[locale] = { name: nameMissing, description: descMissing };
      if (nameMissing) anyNameMissing = true;
      if (descMissing) anyDescMissing = true;
    }
  }

  if (Object.keys(needs).length === 0) return p;

  // 1 ou 2 appels PFS au total (nom + description) qui renvoient toutes
  // les langues d'un coup — pas 8 appels.
  const [allNames, allDescs] = await Promise.all([
    anyNameMissing && p.name.trim()
      ? translateToAllLocales(p.name)
      : Promise.resolve({} as Record<string, string>),
    anyDescMissing && p.description.trim()
      ? translateToAllLocales(p.description)
      : Promise.resolve({} as Record<string, string>),
  ]);

  // Construit une nouvelle map de traductions sans muter l'originale.
  const newTranslations: ExportProduct["translations"] = { ...p.translations };
  for (const [locale, need] of Object.entries(needs)) {
    const existing = newTranslations[locale] ?? { name: "", description: "" };
    const name = need.name ? (allNames[locale] ?? existing.name).trim() : existing.name;
    const description = need.description
      ? (allDescs[locale] ?? existing.description).trim()
      : existing.description;
    if (name || description) {
      newTranslations[locale] = { name, description };
    }
  }

  return { ...p, translations: newTranslations };
}
