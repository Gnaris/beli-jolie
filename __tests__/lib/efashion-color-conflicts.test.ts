/**
 * Tests pour le helper de détection des conflits de mapping eFashion.
 *
 * Miroir de `pfs-color-conflicts.test.ts` — l'API est identique mais typée
 * `number` au lieu de `string` (les IDs eFashion sont des entiers de la biblio
 * officielle : 78 = Doré, 22 = Argent, etc.).
 */
import { describe, it, expect } from "vitest";
import {
  effectiveEfashionColorId,
  detectEfashionColorConflicts,
  validateEfashionOverrideAgainstPrincipal,
  validateEfashionOverridesNotMatchingPrincipal,
  formatEfashionConflictsMessage,
  detectEfashionConflictsForDbProduct,
  assertNoEfashionColorConflicts,
} from "@/lib/efashion-color-conflicts";

describe("effectiveEfashionColorId", () => {
  it("retourne le principal si pas d'override", () => {
    expect(effectiveEfashionColorId({ principalId: 78, overrideId: null })).toBe(78);
  });

  it("retourne l'override si défini", () => {
    expect(effectiveEfashionColorId({ principalId: 78, overrideId: 22 })).toBe(22);
  });

  it("retourne null si ni principal ni override", () => {
    expect(effectiveEfashionColorId({ principalId: null, overrideId: null })).toBeNull();
  });

  it("respecte un override = 0 explicite (peu probable mais on ne remappe pas)", () => {
    // 0 est traité comme un ID valide côté eFashion — on ne le confond pas avec null.
    expect(effectiveEfashionColorId({ principalId: 78, overrideId: 0 })).toBe(0);
  });
});

describe("detectEfashionColorConflicts", () => {
  it("aucun conflit pour 2 couleurs avec mappings différents", () => {
    const result = detectEfashionColorConflicts([
      { key: "v1", label: "Doré", principalId: 78, overrideId: null },
      { key: "v2", label: "Argenté", principalId: 22, overrideId: null },
    ]);
    expect(result).toEqual([]);
  });

  it("détecte 2 couleurs qui partagent le même mapping principal", () => {
    const result = detectEfashionColorConflicts([
      { key: "v1", label: "Or pâle", principalId: 78, overrideId: null },
      { key: "v2", label: "Or rose", principalId: 78, overrideId: null },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.effectiveId).toBe(78);
    expect(result[0]!.variants).toHaveLength(2);
  });

  it("ne signale PAS 2 variantes de la même couleur (même colorId) comme conflit", () => {
    const result = detectEfashionColorConflicts([
      { key: "v1", colorId: "cid-doré", label: "Doré", principalId: 78, overrideId: null },
      { key: "v2", colorId: "cid-doré", label: "Doré", principalId: 78, overrideId: null },
    ]);
    expect(result).toEqual([]);
  });

  it("un override résout le conflit entre 2 couleurs sur le même principal", () => {
    const result = detectEfashionColorConflicts([
      { key: "v1", label: "Or pâle", principalId: 78, overrideId: null },
      { key: "v2", label: "Or rose", principalId: 78, overrideId: 42 },
    ]);
    expect(result).toEqual([]);
  });
});

describe("validateEfashionOverrideAgainstPrincipal", () => {
  it("null override toujours OK", () => {
    expect(validateEfashionOverrideAgainstPrincipal(null, 78)).toBeNull();
  });

  it("refuse override identique au principal", () => {
    expect(validateEfashionOverrideAgainstPrincipal(78, 78)).toMatch(/différent/);
  });

  it("accepte override différent du principal", () => {
    expect(validateEfashionOverrideAgainstPrincipal(22, 78)).toBeNull();
  });
});

describe("validateEfashionOverridesNotMatchingPrincipal", () => {
  it("throw quand un override == principal", () => {
    expect(() =>
      validateEfashionOverridesNotMatchingPrincipal(
        [{ colorId: "c1", efashionColorIdOverride: 78 }],
        new Map([["c1", 78]]),
      ),
    ).toThrow(/différent/);
  });

  it("no-op quand tout est cohérent", () => {
    expect(() =>
      validateEfashionOverridesNotMatchingPrincipal(
        [{ colorId: "c1", efashionColorIdOverride: 22 }],
        new Map([["c1", 78]]),
      ),
    ).not.toThrow();
  });

  it("vérifie aussi les packLines", () => {
    expect(() =>
      validateEfashionOverridesNotMatchingPrincipal(
        [
          {
            colorId: "c1",
            packLines: [{ colorId: "c2", efashionColorIdOverride: 78 }],
          },
        ],
        new Map([
          ["c1", null],
          ["c2", 78],
        ]),
      ),
    ).toThrow(/différent/);
  });
});

describe("formatEfashionConflictsMessage", () => {
  it("chaîne vide si pas de conflit", () => {
    expect(formatEfashionConflictsMessage([])).toBe("");
  });

  it("liste les couleurs en conflit avec l'ID eFashion", () => {
    const msg = formatEfashionConflictsMessage([
      {
        effectiveId: 78,
        variants: [
          { key: "v1", label: "Or pâle", principalId: 78, overrideId: null },
          { key: "v2", label: "Or rose", principalId: 78, overrideId: null },
        ],
      },
    ]);
    expect(msg).toContain("Or pâle");
    expect(msg).toContain("Or rose");
    expect(msg).toContain("78");
  });
});

describe("detectEfashionConflictsForDbProduct + assertNoEfashionColorConflicts", () => {
  it("détecte un conflit sur produit chargé BDD", () => {
    const conflicts = detectEfashionConflictsForDbProduct([
      {
        color: { id: "c1", name: "Or pâle", efashionColorId: 78 },
        efashionColorIdOverride: null,
        packLines: [],
      },
      {
        color: { id: "c2", name: "Or rose", efashionColorId: 78 },
        efashionColorIdOverride: null,
        packLines: [],
      },
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it("assertNoEfashionColorConflicts throw quand conflit", () => {
    expect(() =>
      assertNoEfashionColorConflicts([
        {
          color: { id: "c1", name: "Or pâle", efashionColorId: 78 },
          efashionColorIdOverride: null,
          packLines: [],
        },
        {
          color: { id: "c2", name: "Or rose", efashionColorId: 78 },
          efashionColorIdOverride: null,
          packLines: [],
        },
      ]),
    ).toThrow(/Conflit de mapping eFashion/);
  });

  it("no-op quand tout est distinct", () => {
    expect(() =>
      assertNoEfashionColorConflicts([
        {
          color: { id: "c1", name: "Doré", efashionColorId: 78 },
          efashionColorIdOverride: null,
          packLines: [],
        },
        {
          color: { id: "c2", name: "Argenté", efashionColorId: 22 },
          efashionColorIdOverride: null,
          packLines: [],
        },
      ]),
    ).not.toThrow();
  });
});
