import { describe, expect, it } from "vitest";
import { computeBrandedHash, __TEST_ONLY } from "@/lib/branded-image";

const { buildBadgeSvg } = __TEST_ONLY;

describe("computeBrandedHash", () => {
  it("est déterministe pour les mêmes entrées", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B");
    expect(a).toBe(b);
  });

  it("change quand la référence change", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310C");
    expect(a).not.toBe(b);
  });

  it("change quand la source change", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img-1.webp", "E310B");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img-2.webp", "E310B");
    expect(a).not.toBe(b);
  });

  it("retourne un hash tronqué à 16 caractères hex", () => {
    const h = computeBrandedHash("/foo", "REF");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("buildBadgeSvg", () => {
  it("positionne le badge en haut-droite avec une marge proportionnelle", () => {
    const badge = buildBadgeSvg("E310B", 1200);
    // x = imageWidth - badgeWidth - margin ; margin >= 6, badgeWidth ∈ [90,380]
    expect(badge.y).toBeGreaterThanOrEqual(6);
    expect(badge.x).toBeGreaterThan(0);
    expect(badge.x).toBeLessThan(1200);
  });

  it("s'adapte à une petite image (garde badge min 110px)", () => {
    const smallBadge = buildBadgeSvg("R1", 400);
    // À 400px de large × 28 % = 112 → au-dessus du min, clamp non déclenché
    const svgText = smallBadge.svg.toString();
    const width = svgText.match(/width="(\d+)"/)?.[1];
    expect(Number(width)).toBeGreaterThanOrEqual(110);
  });

  it("s'adapte à une grande image (garde badge max 420px)", () => {
    const bigBadge = buildBadgeSvg("R1", 3000);
    // 3000 × 28 % = 840 → clamp max 420 respecté
    const svgText = bigBadge.svg.toString();
    const width = svgText.match(/width="(\d+)"/)?.[1];
    expect(Number(width)).toBeLessThanOrEqual(420);
  });

  it("inclut le mot RÉFÉRENCE et la référence dans le SVG", () => {
    const badge = buildBadgeSvg("E310B-42", 800);
    const svg = badge.svg.toString();
    expect(svg).toContain("RÉFÉRENCE");
    expect(svg).toContain("E310B-42");
  });

  it("échappe les caractères XML dangereux dans la référence", () => {
    const badge = buildBadgeSvg("A<B&C>", 800);
    const svg = badge.svg.toString();
    expect(svg).toContain("A&lt;B&amp;C&gt;");
    expect(svg).not.toContain("A<B&C>");
  });

  it("produit un SVG bien formé avec les 2 gradients", () => {
    const badge = buildBadgeSvg("R1", 800);
    const svg = badge.svg.toString();
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('id="headerGrad"');
    expect(svg).toContain('id="codeGrad"');
  });
});
