import { describe, it, expect } from "vitest";
import { normalizePfsQuery, scoreMatch } from "@/components/admin/pfs/PfsSuggestions";

describe("normalizePfsQuery", () => {
  it("lowercases, trims and strips diacritics", () => {
    expect(normalizePfsQuery("  Doré  ")).toBe("dore");
    expect(normalizePfsQuery("Or Rosé")).toBe("or rose");
    expect(normalizePfsQuery("ÉTAIN")).toBe("etain");
  });
});

describe("scoreMatch", () => {
  const n = normalizePfsQuery;

  it("returns 100 for exact match", () => {
    expect(scoreMatch(n("Or Rose"), n("Or Rose"))).toBe(100);
    expect(scoreMatch(n("Doré"), n("DORE"))).toBe(100);
  });

  it("scores startsWith higher than contains", () => {
    const startsWith = scoreMatch(n("Or Rose"), n("or"));
    const contains = scoreMatch(n("Noir Doré"), n("or"));
    expect(startsWith).toBeGreaterThan(contains);
  });

  it("returns 0 for no match", () => {
    expect(scoreMatch(n("Argent"), n("xyz"))).toBe(0);
  });

  it("penalises longer candidates to favour concise matches", () => {
    const short = scoreMatch(n("Or"), n("or"));       // exact → 100
    const medium = scoreMatch(n("Or Rose"), n("or")); // startsWith, len diff 5
    const long = scoreMatch(n("Or Rose Pâle"), n("or")); // startsWith, len diff 10
    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThanOrEqual(long);
  });

  it("handles short candidates contained in the query", () => {
    // User typed "Or Rose Clair" but the canonical PFS value is "Or Rose"
    expect(scoreMatch(n("Or Rose"), n("Or Rose Clair"))).toBeGreaterThan(0);
  });

  it("returns 0 when either side is empty", () => {
    expect(scoreMatch("", "abc")).toBe(0);
    expect(scoreMatch("abc", "")).toBe(0);
  });
});
