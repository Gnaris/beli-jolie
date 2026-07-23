import { describe, it, expect } from "vitest";

/**
 * Tests du helper interne `expandLineQuantitiesBySize` de `lib/efashion-stock-deduction.ts`.
 * On duplique la logique en petit ici (le helper n'est pas exporté) : le but est de
 * documenter le contrat d'entrée/sortie et de détecter toute régression future.
 */

function expandLineQuantitiesBySize(
  quantitiesJson: unknown,
  declinaisonsJson: unknown,
): Array<{ sizeLabelFr: string | null; units: number }> {
  const qs = (quantitiesJson ?? {}) as Record<string, unknown>;
  const ds = (declinaisonsJson ?? {}) as Record<string, unknown>;
  const out: Array<{ sizeLabelFr: string | null; units: number }> = [];
  for (let i = 1; i <= 12; i++) {
    const rawQty = qs[`q${i}`];
    const units = typeof rawQty === "number" ? rawQty : Number(rawQty ?? 0);
    if (!Number.isFinite(units) || units <= 0) continue;
    const rawLabel = ds[`d${i}_FR`];
    const sizeLabelFr = typeof rawLabel === "string" ? rawLabel : null;
    out.push({ sizeLabelFr, units });
  }
  return out;
}

describe("efashion-stock-deduction — expandLineQuantitiesBySize", () => {
  it("cas taille unique : {q1:2, d1_FR:'Taille unique'} → 1 bucket", () => {
    const out = expandLineQuantitiesBySize(
      { q1: 2, q2: 0, q3: 0 },
      { d1_FR: "Taille unique", d2_FR: null },
    );
    expect(out).toEqual([{ sizeLabelFr: "Taille unique", units: 2 }]);
  });

  it("multi-tailles : {q1:2, q2:3, q3:1} → 3 buckets ordonnés", () => {
    const out = expandLineQuantitiesBySize(
      { q1: 2, q2: 3, q3: 1 },
      { d1_FR: "S", d2_FR: "M", d3_FR: "L" },
    );
    expect(out).toEqual([
      { sizeLabelFr: "S", units: 2 },
      { sizeLabelFr: "M", units: 3 },
      { sizeLabelFr: "L", units: 1 },
    ]);
  });

  it("ignore les q_i à zéro ou négatifs", () => {
    const out = expandLineQuantitiesBySize(
      { q1: 0, q2: -1, q3: 4 },
      { d1_FR: "S", d2_FR: "M", d3_FR: "L" },
    );
    expect(out).toEqual([{ sizeLabelFr: "L", units: 4 }]);
  });

  it("gère les tailles null (déclinaisons manquantes)", () => {
    const out = expandLineQuantitiesBySize({ q1: 2 }, { d1_FR: null });
    expect(out).toEqual([{ sizeLabelFr: null, units: 2 }]);
  });

  it("gère les JSON entièrement vides", () => {
    expect(expandLineQuantitiesBySize(null, null)).toEqual([]);
    expect(expandLineQuantitiesBySize({}, {})).toEqual([]);
  });
});
