import { describe, it, expect } from "vitest";
import { findExistingDeclinaisonMatch } from "@/lib/efashion-declinaison-matcher";
import type { EfashionDeclinaison } from "@/lib/efashion-annexes";

const declinaisons: EfashionDeclinaison[] = [
  {
    id: 11096,
    titre: "TU",
    sizes: [{ field: "d1_FR", value: "TU" }],
  },
  {
    id: 11542,
    titre: "Bague 17-22",
    sizes: [
      { field: "d1_FR", value: "17" },
      { field: "d2_FR", value: "18" },
      { field: "d3_FR", value: "19" },
      { field: "d4_FR", value: "20" },
      { field: "d5_FR", value: "21" },
      { field: "d6_FR", value: "22" },
    ],
  },
  {
    id: 13200,
    titre: "Bague 17-21",
    sizes: [
      { field: "d1_FR", value: "17" },
      { field: "d2_FR", value: "18" },
      { field: "d3_FR", value: "19" },
      { field: "d4_FR", value: "20" },
      { field: "d5_FR", value: "21" },
    ],
  },
  {
    id: 11140,
    titre: "Vêtements Femme",
    sizes: [
      { field: "d1_FR", value: "XS" },
      { field: "d2_FR", value: "S" },
      { field: "d3_FR", value: "M" },
      { field: "d4_FR", value: "L" },
      { field: "d5_FR", value: "XL" },
    ],
  },
];

describe("findExistingDeclinaisonMatch", () => {
  it("returns null when no sizes given", () => {
    expect(findExistingDeclinaisonMatch([], declinaisons)).toBeNull();
  });

  it("matches the exact declinaison (TU)", () => {
    const res = findExistingDeclinaisonMatch(["TU"], declinaisons);
    expect(res).not.toBeNull();
    expect(res!.declinaisonId).toBe(11096);
    expect(res!.exactMatch).toBe(true);
    expect(res!.fieldByBjSize).toEqual({ TU: "d1_FR" });
  });

  it("prefers the smallest superset when 2 declinaisons match", () => {
    // Sizes 17,18 are present in both 11542 (6 sizes) and 13200 (5 sizes)
    // → prefer 13200 (smaller)
    const res = findExistingDeclinaisonMatch(["17", "18"], declinaisons);
    expect(res!.declinaisonId).toBe(13200);
    expect(res!.exactMatch).toBe(false);
  });

  it("prefers exact match over superset", () => {
    // [17,18,19,20,21] matches 13200 exactly; 11542 is a superset.
    // Exact match wins.
    const res = findExistingDeclinaisonMatch(["17", "18", "19", "20", "21"], declinaisons);
    expect(res!.declinaisonId).toBe(13200);
    expect(res!.exactMatch).toBe(true);
  });

  it("handles different ordering and case", () => {
    const res = findExistingDeclinaisonMatch(["M", "s", "XL", "xs", "L"], declinaisons);
    expect(res!.declinaisonId).toBe(11140);
    expect(res!.exactMatch).toBe(true);
    // Mapping preserves original BJ names but points to right fields
    expect(res!.fieldByBjSize["M"]).toBe("d3_FR");
    expect(res!.fieldByBjSize["xs"]).toBe("d1_FR");
  });

  it("returns null when one required size is missing from all", () => {
    // "42" doesn't exist anywhere
    const res = findExistingDeclinaisonMatch(["17", "42"], declinaisons);
    expect(res).toBeNull();
  });

  it("returns null when the union is not covered by any single declinaison", () => {
    // "TU" exists in 11096 but "S" doesn't → no single declinaison covers [TU,S]
    const res = findExistingDeclinaisonMatch(["TU", "S"], declinaisons);
    expect(res).toBeNull();
  });
});
