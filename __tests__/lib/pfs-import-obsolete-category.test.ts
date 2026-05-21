import { describe, it, expect } from "vitest";

/**
 * Bug 1 : PFS expose parfois deux entrées pour la même catégorie (ex: deux
 * "Blouses" : un ID ancien obsolète + un ID nouveau actif). Quand la cliente
 * a mappé la version qui fonctionne, le `pfsCategoryId` local pointe sur le
 * NOUVEAU. Mais des produits anciens reviennent avec l'ID OBSOLETE — le
 * lookup par pfsCategoryId échoue. Le repli par NOM rattrape ce cas.
 *
 * Bug 2 (mai 2026) : lors d'un bulk import après clear de BDD, l'ordre
 * historique (primary > family > name) collapsait tous les bijoux dans
 * la première catégorie du rayon créée (ex: bagues importées comme parures
 * parce que "Parures de bijoux" était créée en premier avec
 * pfsFamilyName="Bijoux_Fantaisie", et toutes les bagues retombaient sur
 * elle via le family fallback avant que leur nom soit testé). Fix : on
 * teste le NOM avant la famille.
 */

import { pickImportCategory } from "@/lib/pfs-import";

const PRIMARY = { id: "cat-primary", name: "Blouses" };
const FAMILY = { id: "cat-family", name: "Parures de bijoux" };
const NAME = { id: "cat-name", name: "Bagues" };

describe("pickImportCategory — priorité des 3 méthodes de matching", () => {
  it("retourne le match pfsCategoryId quand il existe (priorité 1)", () => {
    expect(pickImportCategory(PRIMARY, FAMILY, NAME)).toEqual({
      category: PRIMARY,
      matchedBy: "pfsCategoryId",
    });
  });

  it("retombe sur le nom local quand pfsCategoryId rate (priorité 2)", () => {
    expect(pickImportCategory(null, FAMILY, NAME)).toEqual({
      category: NAME,
      matchedBy: "name",
    });
  });

  it("retombe sur pfsFamilyName en dernier recours quand nom absent", () => {
    expect(pickImportCategory(null, FAMILY, null)).toEqual({
      category: FAMILY,
      matchedBy: "pfsFamilyName",
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
    const r1 = pickImportCategory(PRIMARY, FAMILY, NAME);
    expect(r1.matchedBy).toBe("pfsCategoryId");
    expect(r1.category).toBe(PRIMARY);

    // pfsCategoryId rate, name match → family ignoré (anti-collapse rayon)
    const r2 = pickImportCategory(null, FAMILY, NAME);
    expect(r2.matchedBy).toBe("name");
    expect(r2.category).toBe(NAME);
  });
});
