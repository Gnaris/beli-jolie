/**
 * eFashion Paris — Résolution automatique de déclinaison à la publication.
 *
 * Problématique : chez eFashion, un produit a UNE déclinaison (= un paquet
 * fixe de tailles, ex: « Pointures Femme » = [36,37,38,39,40]). Tous les
 * dN_FR du produit viennent de cette déclinaison.
 *
 * Chez BJ, chaque produit pioche librement dans la bibliothèque globale de
 * tailles. Au moment de publier, on doit :
 *  1. lister l'ensemble des tailles utilisées par le produit ;
 *  2. chercher une déclinaison eFashion qui couvre cet ensemble ;
 *  3. si trouvée → l'utiliser et mapper chaque taille à son champ dN_FR ;
 *  4. si non trouvée → auto-créer une nouvelle déclinaison côté eFashion
 *     (endpoint à confirmer via capture HAR — voir TODO ci-dessous).
 *
 * Stratégie de match :
 *  - Égalité stricte (mêmes tailles, dans n'importe quel ordre) → score max
 *  - Superset (la déclinaison contient toutes nos tailles + d'autres) → OK
 *  - Sinon → pas de match
 *
 * Si plusieurs déclinaisons matchent, on préfère la plus petite (la plus
 * spécifique) pour éviter de polluer un produit avec 12 champs vides.
 */

import { revalidateTag } from "next/cache";

import { getEfashionAnnexes, type EfashionDeclinaison } from "@/lib/efashion-annexes";
import { logger } from "@/lib/logger";

export interface DeclinaisonMatch {
  /** id_declinaison eFashion à envoyer dans `idDeclinaison` au moment de la création. */
  declinaisonId: number;
  /** Titre lisible de la déclinaison (pour logs/UI). */
  declinaisonTitre: string;
  /**
   * Mapping {nomTailleBJ → champ eFashion dN_FR}. Sert à savoir où poser
   * le stock dans le shooting/saveProduitStocks.
   */
  fieldByBjSize: Record<string, string>;
  /** true si match parfait, false si la déclinaison contient plus de tailles. */
  exactMatch: boolean;
}

function normalizeSize(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Tri intelligent pour l'affichage dans le titre auto-créé :
 *  - Si toutes les tailles sont numériques → tri ascendant numérique (17, 18, 19…)
 *  - Sinon → ordre d'arrivée préservé (XS, S, M, L, XL — supposé déjà dans le bon ordre côté BJ)
 */
function sortSizesForDisplay(sizes: string[]): string[] {
  const allNumeric = sizes.every((s) => /^\d+([.,]\d+)?$/.test(s.trim()));
  if (!allNumeric) return [...sizes];
  return [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b));
}

/**
 * Cherche dans les déclinaisons existantes celle qui couvre l'ensemble fourni.
 * Retourne null si aucune ne convient.
 */
export function findExistingDeclinaisonMatch(
  bjSizeNames: string[],
  declinaisons: EfashionDeclinaison[],
): DeclinaisonMatch | null {
  const needed = bjSizeNames.map(normalizeSize);
  if (needed.length === 0) return null;
  const neededSet = new Set(needed);

  const candidates: Array<{ decl: EfashionDeclinaison; coveredCount: number; isExact: boolean }> = [];

  for (const decl of declinaisons) {
    const sizeValues = decl.sizes.map((s) => normalizeSize(s.value));
    const sizeValuesSet = new Set(sizeValues);

    // Vérifie que toutes les tailles BJ sont présentes dans la déclinaison
    const allCovered = needed.every((n) => sizeValuesSet.has(n));
    if (!allCovered) continue;

    // Cherche un match exact (mêmes tailles strictement)
    const isExact =
      sizeValues.length === needed.length &&
      sizeValues.every((s) => neededSet.has(s));

    candidates.push({
      decl,
      coveredCount: sizeValues.length,
      isExact,
    });
  }

  if (candidates.length === 0) return null;

  // Priorité : match exact > sinon la plus petite (la plus spécifique)
  candidates.sort((a, b) => {
    if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
    return a.coveredCount - b.coveredCount;
  });

  const winner = candidates[0];
  const fieldByBjSize: Record<string, string> = {};
  const bySizeValue = new Map(
    winner.decl.sizes.map((s) => [normalizeSize(s.value), s.field]),
  );
  for (const bjName of bjSizeNames) {
    const field = bySizeValue.get(normalizeSize(bjName));
    if (field) fieldByBjSize[bjName] = field;
  }

  return {
    declinaisonId: winner.decl.id,
    declinaisonTitre: winner.decl.titre,
    fieldByBjSize,
    exactMatch: winner.isExact,
  };
}

/**
 * Point d'entrée principal : retourne le mapping pour un produit BJ.
 * Charge les annexes, tente le match, et — si rien ne convient — auto-crée
 * une nouvelle déclinaison côté eFashion (mutation `createDeclinaison`).
 *
 * @param suggestedTitre Titre humain à utiliser si on doit créer une nouvelle
 *   déclinaison (ex: nom catégorie ou référence produit BJ). Limite 50 car.
 */
export async function resolveEfashionDeclinaison(
  bjSizeNames: string[],
  suggestedTitre?: string,
): Promise<
  | { success: true; match: DeclinaisonMatch; createdNew?: boolean }
  | { success: false; error: string }
> {
  if (bjSizeNames.length === 0) {
    return { success: false, error: "Aucune taille fournie." };
  }
  if (bjSizeNames.length > 12) {
    return {
      success: false,
      error: `eFashion accepte au maximum 12 tailles par produit (${bjSizeNames.length} fournies).`,
    };
  }

  const annexes = await getEfashionAnnexes();
  const existing = findExistingDeclinaisonMatch(bjSizeNames, annexes.declinaisons);

  if (existing) {
    logger.info("[eFashion declinaison] matched", {
      bjSizes: bjSizeNames,
      declinaisonId: existing.declinaisonId,
      titre: existing.declinaisonTitre,
      exact: existing.exactMatch,
    });
    return { success: true, match: existing };
  }

  // Aucun match → on crée une nouvelle déclinaison côté eFashion
  logger.info("[eFashion declinaison] no match, creating", { bjSizes: bjSizeNames });
  try {
    const { efashionCreateDeclinaison } = await import("@/lib/efashion-api-write");
    const { efashionGetMe } = await import("@/lib/efashion-api");
    const me = await efashionGetMe();

    // Titre lisible : suggestion utilisateur (catégorie/réf produit) + range
    // de tailles. Format : « Bagues (17-21) ».
    // Limité à 50 caractères pour rester propre côté eFashion.
    const sortedForTitle = sortSizesForDisplay(bjSizeNames);
    const sizeRange =
      sortedForTitle.length > 3
        ? `${sortedForTitle[0]}-${sortedForTitle[sortedForTitle.length - 1]}`
        : sortedForTitle.join(", ");
    const baseTitre = (suggestedTitre ?? "BJ auto").trim().slice(0, 30);
    const titre = `${baseTitre} (${sizeRange})`.slice(0, 50);

    const created = await efashionCreateDeclinaison({
      id_vendeur: me.id_vendeur,
      titre,
      sizes: bjSizeNames,
    });

    // Invalide le cache des annexes : la nouvelle déclinaison doit apparaître
    // dans les prochains appels.
    try {
      revalidateTag("efashion-annexes", "default");
    } catch {
      // Hors contexte Next.js (script tsx) — pas grave
    }

    const fieldByBjSize: Record<string, string> = {};
    bjSizeNames.forEach((bjName, idx) => {
      fieldByBjSize[bjName] = `d${idx + 1}_FR`;
    });

    return {
      success: true,
      createdNew: true,
      match: {
        declinaisonId: Number(created.id_declinaison),
        declinaisonTitre: created.titre,
        fieldByBjSize,
        exactMatch: true,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[eFashion declinaison] auto-create failed", { error: msg });
    return {
      success: false,
      error:
        `Aucune déclinaison eFashion existante ne convient et l'auto-création a échoué : ${msg}. ` +
        "Créez manuellement la déclinaison dans votre back-office eFashion et réessayez.",
    };
  }
}
