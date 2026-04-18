import { describe, it, expect, beforeEach } from "vitest";
import { getPfsAnnexes, clearPfsAnnexesCache } from "@/lib/marketplace-excel/pfs-annexes";

describe("PFS annexes parser — reads the official template", () => {
  beforeEach(() => clearPfsAnnexesCache());

  it("extracts at least 20 (gender, family) pairs with the 4 expected genders", async () => {
    const a = await getPfsAnnexes();
    expect(a.families.length).toBeGreaterThanOrEqual(20);
    const genders = new Set(a.families.map((f) => f.gender));
    expect(genders.has("Femme")).toBe(true);
    expect(genders.has("Homme")).toBe(true);
    expect(genders.has("Enfant")).toBe(true);
    expect(genders.has("Lifestyle_et_Plus")).toBe(true);
  });

  it("includes the standard 'Femme / Bijoux_Fantaisie' branch with its categories", async () => {
    const a = await getPfsAnnexes();
    expect(a.families).toContainEqual({ gender: "Femme", family: "Bijoux_Fantaisie" });
    const boucles = a.categories.find(
      (c) => c.gender === "Femme" && c.family === "Bijoux_Fantaisie" && c.category === "Boucles d'oreilles",
    );
    expect(boucles).toBeDefined();
  });

  it("extracts color + motif labels as a flat list", async () => {
    const a = await getPfsAnnexes();
    expect(a.colors.length).toBeGreaterThan(50);
    expect(a.colors).toContain("Doré");
    expect(a.colors).toContain("Noir");
    // Banner labels like "COULEURS" must be filtered out
    expect(a.colors).not.toContain("COULEURS");
    expect(a.colors).not.toContain("NOIR");
  });

  it("extracts compositions covering the 4 scopes (textile + sacs + bijoux + fournitures)", async () => {
    const a = await getPfsAnnexes();
    expect(a.compositions.length).toBeGreaterThan(40);
    expect(a.compositions).toContain("Coton");
    expect(a.compositions).toContain("Acier inoxydable");
    expect(a.compositions).toContain("Polyester");
  });

  it("extracts country names (French)", async () => {
    const a = await getPfsAnnexes();
    expect(a.countries).toContain("France");
    expect(a.countries).toContain("Chine");
    expect(a.countries).toContain("Italie");
  });

  it("extracts size labels without section headers", async () => {
    const a = await getPfsAnnexes();
    expect(a.sizes).toContain("TU");
    expect(a.sizes).toContain("XS");
    expect(a.sizes).toContain("S");
    expect(a.sizes).toContain("M");
    expect(a.sizes).toContain("L");
    // Section labels (like "Vêtements", "Adulte") must not leak in
    expect(a.sizes).not.toContain("Vêtements");
    expect(a.sizes).not.toContain("Adulte");
    expect(a.sizes).not.toContain("Enfants");
  });

  it("caches the parsed result across calls", async () => {
    const first = await getPfsAnnexes();
    const second = await getPfsAnnexes();
    expect(second).toBe(first); // Same object reference → cache hit
  });
});
