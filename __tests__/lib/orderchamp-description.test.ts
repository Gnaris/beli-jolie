import { describe, it, expect } from "vitest";
import { buildOrderchampDescription } from "@/lib/orderchamp-description";

describe("orderchamp-description", () => {
  it("concatène base + compositions + tailles + made-in", () => {
    const desc = buildOrderchampDescription(
      "Bracelet fin en acier inoxydable.",
      [
        { name: "Acier inoxydable 316L", percentage: 70 },
        { name: "Plaqué or 18 carats", percentage: 30 },
      ],
      { sizes: ["S", "M"], madeInCountryEn: "China" },
    );
    expect(desc).toContain("Bracelet fin en acier inoxydable.");
    expect(desc).toContain("Composition : Acier inoxydable 316L (70%), Plaqué or 18 carats (30%)");
    expect(desc).toContain("Tailles : S, M");
    expect(desc).toContain("Made in China");
  });

  it("gère la Taille Unique avec détail TU", () => {
    const desc = buildOrderchampDescription("Base.", [], {
      sizes: ["TU"],
      sizeDetailsTu: "38-42",
    });
    expect(desc).toContain("Taille Unique (38-42)");
  });

  it("skip les sections vides", () => {
    const desc = buildOrderchampDescription("", [], {});
    expect(desc).toBe("");
  });

  it("dédoublonne les tailles identiques", () => {
    const desc = buildOrderchampDescription("Base.", [], {
      sizes: ["S", "S", "M", "M"],
    });
    expect(desc).toContain("Tailles : S, M");
  });

  it("format % gère les décimales", () => {
    const desc = buildOrderchampDescription("Base.", [
      { name: "Acier", percentage: 33.3 },
    ]);
    expect(desc).toContain("(33.3%)");
  });
});
