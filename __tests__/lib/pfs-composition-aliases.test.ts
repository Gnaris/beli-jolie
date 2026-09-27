/**
 * Tests du mapping alias compositions PFS.
 *
 * Objectif : garantir que l'audit PFS traite les anciens libellés (ex :
 * "Elastane") comme leur équivalent canonique local ("Élasthanne") sans
 * que la cliente ait à créer un doublon dans sa bibliothèque.
 */

import { describe, it, expect } from "vitest";
import { canonicalizePfsCompositionKey } from "@/lib/pfs-composition-aliases";
import { normalizeDictKey } from "@/lib/pfs-admin-api";

describe("canonicalizePfsCompositionKey", () => {
  it("réécrit ELASTANE en ELASTHANNE (ancien libellé PFS → canonique)", () => {
    expect(canonicalizePfsCompositionKey("ELASTANE")).toBe("ELASTHANNE");
  });

  it("laisse ELASTHANNE inchangé (déjà canonique)", () => {
    expect(canonicalizePfsCompositionKey("ELASTHANNE")).toBe("ELASTHANNE");
  });

  it("laisse une clé sans alias inchangée", () => {
    expect(canonicalizePfsCompositionKey("COTON")).toBe("COTON");
    expect(canonicalizePfsCompositionKey("PU")).toBe("PU");
    expect(canonicalizePfsCompositionKey("ACIERINOXYDABLE")).toBe("ACIERINOXYDABLE");
  });
});

describe("normalizeDictKey (avec alias appliqué)", () => {
  it("aligne les deux orthographes d'élasthanne sur la même clé", () => {
    // La cliente a "Élasthanne" dans sa bibliothèque. PFS envoie parfois
    // "Elastane" (ancien libellé anglais). Les deux doivent produire la
    // même clé de match.
    const local = normalizeDictKey("Élasthanne");
    const pfsOldLabel = normalizeDictKey("Elastane");
    expect(local).toBe(pfsOldLabel);
    expect(local).toBe("ELASTHANNE");
  });

  it("normalise P.U. sur PU (comportement historique préservé)", () => {
    expect(normalizeDictKey("P.U.")).toBe("PU");
    expect(normalizeDictKey("PU")).toBe("PU");
  });

  it("laisse une matière sans alias inchangée après normalisation", () => {
    expect(normalizeDictKey("Coton")).toBe("COTON");
    expect(normalizeDictKey("COTON")).toBe("COTON");
  });
});
