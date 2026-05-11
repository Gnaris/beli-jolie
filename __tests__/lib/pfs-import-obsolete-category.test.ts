import { describe, it, expect } from "vitest";

/**
 * Bug : PFS expose parfois deux entrées pour la même catégorie (ex: deux
 * "Blouses" : un ID ancien obsolète + un ID nouveau actif). Quand la cliente
 * a mappé la version qui fonctionne, le `pfsCategoryId` local pointe sur le
 * NOUVEAU. Mais des produits anciens reviennent avec l'ID OBSOLETE — le
 * lookup par pfsCategoryId échoue, le repli `pfsFamilyName` aussi, et
 * l'import plantait avec « Catégorie non mappée : "Blouses" ».
 *
 * Fix : `pickImportCategory` ajoute un dernier filet par NOM, qui retrouve
 * la catégorie locale même quand l'ID PFS reçu est obsolète. Le call site
 * (`approveAndImportPfsProduct`) ajoute un warning quand ce filet est utilisé.
 */

import { pickImportCategory } from "@/lib/pfs-import";

const PRIMARY = { id: "cat-primary", name: "Blouses" };
const FAMILY = { id: "cat-family", name: "Blouses" };
const NAME = { id: "cat-name", name: "Blouses" };

describe("pickImportCategory — priorité des 3 méthodes de matching", () => {
  it("retourne le match pfsCategoryId quand il existe (priorité 1)", () => {
    expect(pickImportCategory(PRIMARY, FAMILY, NAME)).toEqual({
      category: PRIMARY,
      matchedBy: "pfsCategoryId",
    });
  });

  it("retombe sur pfsFamilyName quand pfsCategoryId rate", () => {
    expect(pickImportCategory(null, FAMILY, NAME)).toEqual({
      category: FAMILY,
      matchedBy: "pfsFamilyName",
    });
  });

  it("retombe sur le nom local en dernier recours (cas pfsCategoryId obsolète)", () => {
    expect(pickImportCategory(null, null, NAME)).toEqual({
      category: NAME,
      matchedBy: "name",
    });
  });

  it("retourne null + matchedBy null quand aucune méthode ne match", () => {
    expect(pickImportCategory(null, null, null)).toEqual({
      category: null,
      matchedBy: null,
    });
  });

  it("ignore les fallbacks dès que la méthode prioritaire match", () => {
    // pfsCategoryId match → family et name sont ignorés même s'ils existent
    const r1 = pickImportCategory(PRIMARY, null, NAME);
    expect(r1.matchedBy).toBe("pfsCategoryId");
    expect(r1.category).toBe(PRIMARY);

    // pfsCategoryId rate, family match → name ignoré
    const r2 = pickImportCategory(null, FAMILY, NAME);
    expect(r2.matchedBy).toBe("pfsFamilyName");
    expect(r2.category).toBe(FAMILY);
  });
});
