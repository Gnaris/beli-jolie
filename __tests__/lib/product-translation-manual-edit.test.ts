/**
 * Vérifie que le flag `manualEdit` sur ProductTranslation protège les saisies
 * admin d'un futur écrasement par l'auto-traduction PFS.
 *
 * On ne peut pas facilement mocker Prisma sans réécrire tout _autoTranslateProduct.
 * Le test valide donc plutôt le CONTRAT de sélection : les locales avec
 * manualEdit=true doivent apparaître dans le set d'exclusion.
 */

import { describe, it, expect } from "vitest";

interface FakeRow { locale: string; manualEdit: boolean }

/**
 * Reproduit la logique de sélection de `_autoTranslateProduct` :
 *   - `TARGET_LOCALES` = liste des locales cibles
 *   - `existingLocales` = locales déjà écrites lors de la même save (créé
 *     manuellement au create)
 *   - `manuallyEditedRows` = ceux dont manualEdit=true en BDD
 */
function selectLocalesToTranslate(
  target: string[],
  existingLocales: string[],
  manuallyEditedRows: FakeRow[],
): string[] {
  const manuallyEdited = new Set(
    manuallyEditedRows.filter((r) => r.manualEdit).map((r) => r.locale),
  );
  return target.filter(
    (l) => !existingLocales.includes(l) && !manuallyEdited.has(l),
  );
}

describe("auto-translate : verrou manualEdit", () => {
  const TARGETS = ["en", "ar"];

  it("laisse traduire toutes les locales quand rien n'est verrouillé", () => {
    expect(selectLocalesToTranslate(TARGETS, [], [])).toEqual(["en", "ar"]);
  });

  it("skippe les locales déjà remplies dans la même save", () => {
    expect(selectLocalesToTranslate(TARGETS, ["en"], [])).toEqual(["ar"]);
  });

  it("skippe les locales avec manualEdit=true", () => {
    expect(
      selectLocalesToTranslate(TARGETS, [], [{ locale: "en", manualEdit: true }]),
    ).toEqual(["ar"]);
  });

  it("n'est PAS bloqué par une ligne manualEdit=false (auto-traduction ancienne)", () => {
    expect(
      selectLocalesToTranslate(TARGETS, [], [{ locale: "en", manualEdit: false }]),
    ).toEqual(["en", "ar"]);
  });

  it("cumule les deux exclusions sans écraser", () => {
    expect(
      selectLocalesToTranslate(
        TARGETS,
        ["ar"],
        [{ locale: "en", manualEdit: true }],
      ),
    ).toEqual([]);
  });
});
