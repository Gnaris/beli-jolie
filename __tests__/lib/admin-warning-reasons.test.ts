/**
 * Vérifie le détail humain affiché dans l'info-bulle de la pastille parent
 * « Produits » de la sidebar admin. Historique : avant cette extraction, la
 * pastille affichait un total opaque (« 15 traductions manquantes ») alors
 * que le trou était en fait sur les mots-clés — la cliente filtrait les
 * produits par « sans traduction » et tombait à 0, pensant à un bug.
 *
 * Le breakdown liste maintenant uniquement les lignes > 0 et accorde
 * singulier/pluriel. Cat + sous-cat fusionnent sur une même ligne
 * « catégories » (cohérent avec le badge dans le sous-menu).
 */
import { describe, it, expect } from "vitest";

import {
  buildAttributeWarningReasons,
  type AdminWarningsCounts,
  ADMIN_WARNINGS_ZERO,
} from "@/lib/admin-warnings";

function counts(partial: Partial<AdminWarningsCounts>): AdminWarningsCounts {
  return { ...ADMIN_WARNINGS_ZERO, ...partial };
}

describe("buildAttributeWarningReasons", () => {
  it("retourne une liste vide quand aucun compteur n'est renseigné", () => {
    expect(buildAttributeWarningReasons(ADMIN_WARNINGS_ZERO)).toEqual([]);
  });

  it("n'affiche que les lignes > 0", () => {
    const reasons = buildAttributeWarningReasons(
      counts({ unusedTagsCount: 15 }),
    );
    expect(reasons).toEqual(["15 mots-clés sans traduction"]);
  });

  it("accorde singulier/pluriel pour chaque type", () => {
    const reasons = buildAttributeWarningReasons(
      counts({
        untranslatedCount: 1,
        unusedColorsCount: 2,
        unusedCompositionsCount: 1,
        unusedTagsCount: 1,
      }),
    );
    expect(reasons).toContain("1 produit sans traduction");
    expect(reasons).toContain("2 couleurs sans traduction");
    expect(reasons).toContain("1 composition sans traduction");
    expect(reasons).toContain("1 mot-clé sans traduction");
  });

  it("fusionne catégories et sous-catégories sur une même ligne", () => {
    const reasons = buildAttributeWarningReasons(
      counts({
        untranslatedCategoriesCount: 2,
        untranslatedSubCategoriesCount: 3,
      }),
    );
    expect(reasons).toEqual(["5 catégories sans traduction"]);
  });

  it("respecte un ordre stable produits → catégories → couleurs → compositions → mots-clés", () => {
    const reasons = buildAttributeWarningReasons(
      counts({
        untranslatedCount: 1,
        untranslatedCategoriesCount: 1,
        unusedColorsCount: 1,
        unusedCompositionsCount: 1,
        unusedTagsCount: 1,
      }),
    );
    expect(reasons).toEqual([
      "1 produit sans traduction",
      "1 catégorie sans traduction",
      "1 couleur sans traduction",
      "1 composition sans traduction",
      "1 mot-clé sans traduction",
    ]);
  });

  it("scénario beliandjolie prod — 15 mots-clés sans traduction uniquement", () => {
    // Reproduit exactement le cas qui a motivé la correction : la pastille
    // sidebar remontait un total (15) mais le filtre produits renvoyait 0.
    const reasons = buildAttributeWarningReasons(counts({ unusedTagsCount: 15 }));
    expect(reasons).toEqual(["15 mots-clés sans traduction"]);
  });
});
