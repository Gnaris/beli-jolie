/**
 * Tests pour le helper de détection des conflits de mapping PFS.
 */
import { describe, it, expect } from "vitest";
import {
  effectivePfsColorRef,
  detectPfsColorConflicts,
  validateOverrideAgainstPrincipal,
  formatConflictsMessage,
  validateOverridesNotMatchingPrincipal,
  detectPfsConflictsForDbProduct,
  assertNoPfsColorConflicts,
} from "@/lib/pfs-color-conflicts";

describe("effectivePfsColorRef", () => {
  it("retourne le principal si pas d'override", () => {
    expect(effectivePfsColorRef({ principalRef: "DORE", overrideRef: null })).toBe("DORE");
  });

  it("retourne l'override si défini", () => {
    expect(effectivePfsColorRef({ principalRef: "DORE", overrideRef: "ARGENTE" })).toBe("ARGENTE");
  });

  it("considère override vide/whitespace comme absent", () => {
    expect(effectivePfsColorRef({ principalRef: "DORE", overrideRef: "" })).toBe("DORE");
    expect(effectivePfsColorRef({ principalRef: "DORE", overrideRef: "   " })).toBe("DORE");
  });

  it("retourne null si ni principal ni override", () => {
    expect(effectivePfsColorRef({ principalRef: null, overrideRef: null })).toBeNull();
  });
});

describe("detectPfsColorConflicts", () => {
  it("retourne aucun conflit pour 2 variantes avec mappings différents", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Doré", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "Argenté", principalRef: "ARGENTE", overrideRef: null },
    ]);
    expect(result).toEqual([]);
  });

  it("détecte 2 variantes avec le même mapping principal", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Or pâle", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "Or rose", principalRef: "DORE", overrideRef: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveRef).toBe("DORE");
    expect(result[0]!.variants).toHaveLength(2);
  });

  it("détecte conflit principal vs override (override d'une autre variante = principal d'une autre)", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Or pâle", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "Argenté", principalRef: "ARGENTE", overrideRef: "DORE" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveRef).toBe("DORE");
  });

  it("ne détecte pas de conflit quand l'override résout le doublon de principal", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Or pâle", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "Or rose", principalRef: "DORE", overrideRef: "BRONZE" },
    ]);
    expect(result).toEqual([]);
  });

  it("ignore les variantes sans mapping (principal et override null)", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Sans mapping A", principalRef: null, overrideRef: null },
      { key: "v2", label: "Sans mapping B", principalRef: null, overrideRef: null },
    ]);
    expect(result).toEqual([]);
  });

  it("détecte plusieurs groupes de conflits indépendants", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Or pâle", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "Or rose", principalRef: "DORE", overrideRef: null },
      { key: "v3", label: "Argent A", principalRef: "ARGENTE", overrideRef: null },
      { key: "v4", label: "Argent B", principalRef: "ARGENTE", overrideRef: null },
    ]);
    expect(result).toHaveLength(2);
  });

  it("regroupe 3 variantes sur le même mapping", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "A", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "B", principalRef: "DORE", overrideRef: null },
      { key: "v3", label: "C", principalRef: "DORE", overrideRef: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.variants).toHaveLength(3);
  });

  it("ne détecte pas de conflit pour 2 variantes de la MÊME couleur (même colorId)", () => {
    // Cas A322 : 2 variantes UNIT de couleur « Doré » → même mapping PFS « DORE ».
    // C'est juste la même couleur réutilisée, pas un conflit.
    const result = detectPfsColorConflicts([
      { key: "v1", colorId: "doreId", label: "Doré", principalRef: "DORE", overrideRef: null },
      { key: "v2", colorId: "doreId", label: "Doré", principalRef: "DORE", overrideRef: null },
    ]);
    expect(result).toEqual([]);
  });

  it("ne détecte pas de conflit pour 2 variantes de la même couleur (dédup par label si pas de colorId)", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", label: "Doré", principalRef: "DORE", overrideRef: null },
      { key: "v2", label: "Doré", principalRef: "DORE", overrideRef: null },
    ]);
    expect(result).toEqual([]);
  });

  it("détecte conflit entre 2 couleurs DIFFÉRENTES qui pointent sur la même cible", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", colorId: "orPaleId", label: "Or pâle", principalRef: "DORE", overrideRef: null },
      { key: "v2", colorId: "orRoseId", label: "Or rose", principalRef: "DORE", overrideRef: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.variants).toHaveLength(2);
  });

  it("dédup mixte : 3 variantes même couleur + 1 variante autre couleur sur même cible → conflit entre 2 couleurs uniques", () => {
    const result = detectPfsColorConflicts([
      { key: "v1", colorId: "doreId", label: "Doré", principalRef: "DORE", overrideRef: null },
      { key: "v2", colorId: "doreId", label: "Doré", principalRef: "DORE", overrideRef: null },
      { key: "v3", colorId: "doreId", label: "Doré", principalRef: "DORE", overrideRef: null },
      { key: "v4", colorId: "bronzeId", label: "Bronze", principalRef: "DORE", overrideRef: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.variants).toHaveLength(2);
    const labels = result[0]!.variants.map((v) => v.label).sort();
    expect(labels).toEqual(["Bronze", "Doré"]);
  });
});

describe("validateOverrideAgainstPrincipal", () => {
  it("accepte un override absent", () => {
    expect(validateOverrideAgainstPrincipal(null, "DORE")).toBeNull();
    expect(validateOverrideAgainstPrincipal("", "DORE")).toBeNull();
  });

  it("accepte un override différent du principal", () => {
    expect(validateOverrideAgainstPrincipal("ARGENTE", "DORE")).toBeNull();
  });

  it("rejette un override identique au principal", () => {
    const msg = validateOverrideAgainstPrincipal("DORE", "DORE");
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/différent du mapping principal/i);
  });

  it("accepte un override quand le principal est null (cas dégénéré)", () => {
    expect(validateOverrideAgainstPrincipal("DORE", null)).toBeNull();
  });
});

describe("formatConflictsMessage", () => {
  it("retourne une chaîne vide pour aucun conflit", () => {
    expect(formatConflictsMessage([])).toBe("");
  });

  it("formate un conflit unique", () => {
    const msg = formatConflictsMessage([
      {
        effectiveRef: "DORE",
        variants: [
          { key: "v1", label: "Or pâle", principalRef: "DORE", overrideRef: null },
          { key: "v2", label: "Or rose", principalRef: "DORE", overrideRef: null },
        ],
      },
    ]);
    expect(msg).toContain("Or pâle");
    expect(msg).toContain("Or rose");
    expect(msg).toContain("DORE");
  });
});

describe("validateOverridesNotMatchingPrincipal", () => {
  it("ne throw pas si pas d'override", () => {
    const map = new Map<string, string | null>([["c1", "DORE"]]);
    expect(() =>
      validateOverridesNotMatchingPrincipal(
        [{ colorId: "c1", pfsColorRefOverride: null }],
        map,
      ),
    ).not.toThrow();
  });

  it("throw si override = principal sur la variante", () => {
    const map = new Map<string, string | null>([["c1", "DORE"]]);
    expect(() =>
      validateOverridesNotMatchingPrincipal(
        [{ colorId: "c1", pfsColorRefOverride: "DORE" }],
        map,
      ),
    ).toThrow(/différent du mapping principal/i);
  });

  it("throw si override = principal sur une ligne de pack", () => {
    const map = new Map<string, string | null>([["c1", "ARGENTE"]]);
    expect(() =>
      validateOverridesNotMatchingPrincipal(
        [
          {
            colorId: "c2",
            packLines: [{ colorId: "c1", pfsColorRefOverride: "ARGENTE" }],
          },
        ],
        map,
      ),
    ).toThrow();
  });

  it("accepte un override différent du principal", () => {
    const map = new Map<string, string | null>([["c1", "DORE"]]);
    expect(() =>
      validateOverridesNotMatchingPrincipal(
        [{ colorId: "c1", pfsColorRefOverride: "BRONZE" }],
        map,
      ),
    ).not.toThrow();
  });
});

describe("detectPfsConflictsForDbProduct + assertNoPfsColorConflicts", () => {
  it("aucun conflit pour 1 variante", () => {
    const conflicts = detectPfsConflictsForDbProduct([
      {
        color: { name: "Doré", pfsColorRef: "DORE" },
        pfsColorRefOverride: null,
        packLines: [],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("détecte conflit entre 2 variantes UNIT avec même mapping principal", () => {
    const conflicts = detectPfsConflictsForDbProduct([
      {
        color: { name: "Or pâle", pfsColorRef: "DORE" },
        pfsColorRefOverride: null,
        packLines: [],
      },
      {
        color: { name: "Or rose", pfsColorRef: "DORE" },
        pfsColorRefOverride: null,
        packLines: [],
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.effectiveRef).toBe("DORE");
  });

  it("résout le conflit via override secondaire", () => {
    const conflicts = detectPfsConflictsForDbProduct([
      {
        color: { name: "Or pâle", pfsColorRef: "DORE" },
        pfsColorRefOverride: null,
        packLines: [],
      },
      {
        color: { name: "Or rose", pfsColorRef: "DORE" },
        pfsColorRefOverride: "BRONZE",
        packLines: [],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("détecte conflit entre 2 lignes de pack", () => {
    const conflicts = detectPfsConflictsForDbProduct([
      {
        color: { name: "Pack", pfsColorRef: "PACK" },
        pfsColorRefOverride: null,
        packLines: [
          { color: { name: "Or pâle", pfsColorRef: "DORE" }, pfsColorRefOverride: null },
          { color: { name: "Or rose", pfsColorRef: "DORE" }, pfsColorRefOverride: null },
        ],
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.effectiveRef).toBe("DORE");
  });

  it("ne détecte pas de conflit DB pour 2 variantes UNIT de la même couleur (cas A322)", () => {
    const conflicts = detectPfsConflictsForDbProduct([
      {
        color: { id: "doreId", name: "Doré", pfsColorRef: "DORE" },
        pfsColorRefOverride: null,
        packLines: [],
      },
      {
        color: { id: "doreId", name: "Doré", pfsColorRef: "DORE" },
        pfsColorRefOverride: null,
        packLines: [],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("assertNoPfsColorConflicts ne throw pas si pas de conflit", () => {
    expect(() =>
      assertNoPfsColorConflicts([
        {
          color: { name: "Doré", pfsColorRef: "DORE" },
          pfsColorRefOverride: null,
          packLines: [],
        },
      ]),
    ).not.toThrow();
  });

  it("assertNoPfsColorConflicts throw avec message clair en cas de conflit", () => {
    expect(() =>
      assertNoPfsColorConflicts([
        {
          color: { name: "Or pâle", pfsColorRef: "DORE" },
          pfsColorRefOverride: null,
          packLines: [],
        },
        {
          color: { name: "Or rose", pfsColorRef: "DORE" },
          pfsColorRefOverride: null,
          packLines: [],
        },
      ]),
    ).toThrow(/Conflit de mapping PFS/);
  });
});
