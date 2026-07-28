import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  composeBrandedBuffer,
  computeBrandedHash,
  __TEST_ONLY,
} from "@/lib/branded-image";

const { buildBadgeSvg } = __TEST_ONLY;

describe("computeBrandedHash", () => {
  it("est déterministe pour les mêmes entrées", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large");
    expect(a).toBe(b);
  });

  it("change quand la référence change", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310C", "large");
    expect(a).not.toBe(b);
  });

  it("change quand la source change", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img-1.webp", "E310B", "large");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img-2.webp", "E310B", "large");
    expect(a).not.toBe(b);
  });

  it("change quand minWidth change (isolation cache marketplace)", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large", 500);
    const b = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large", 1000);
    expect(a).not.toBe(b);
  });

  it("retourne un hash tronqué à 16 caractères hex", () => {
    const h = computeBrandedHash("/foo", "REF", "large");
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

describe("composeBrandedBuffer (minWidth)", () => {
  async function makeSource(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .webp()
      .toBuffer();
  }

  it("upscale une source 700px à minWidth 1000 (contrainte Faire)", async () => {
    const src = await makeSource(700, 700);
    const out = await composeBrandedBuffer({
      sourceBuffer: src,
      reference: "REF",
      size: "large",
      minWidth: 1000,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width ?? 0).toBeGreaterThanOrEqual(1000);
  });

  it("upscale une source 300px à minWidth 500 (contrainte Ankorstore)", async () => {
    const src = await makeSource(300, 300);
    const out = await composeBrandedBuffer({
      sourceBuffer: src,
      reference: "REF",
      size: "large",
      minWidth: 500,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width ?? 0).toBeGreaterThanOrEqual(500);
  });

  it("ne rétrécit pas une source déjà plus grande que minWidth", async () => {
    const src = await makeSource(1400, 1400);
    const out = await composeBrandedBuffer({
      sourceBuffer: src,
      reference: "REF",
      size: "large",
      minWidth: 1000,
    });
    const meta = await sharp(out).metadata();
    // SIZE_TARGETS.large = 1200 → l'image est cappée à 1200 (fit:inside)
    expect(meta.width ?? 0).toBeLessThanOrEqual(1200);
    expect(meta.width ?? 0).toBeGreaterThanOrEqual(1000);
  });

  // Régression 2026-07-28 : les photos produit Beli & Jolie sont portrait
  // 800×1200. `resize(1200, 1200, {fit:"inside"})` les laissait à 800 de large
  // (elles tenaient déjà dans la boîte carrée), Faire refusait alors avec
  // « image < 1000px ». Le fix : quand `minWidth > srcW`, forcer la largeur
  // explicitement via `resize(minWidth, null)`.
  it("upscale une source portrait 800×1200 à minWidth 1000 (bug v3, fix v4)", async () => {
    const src = await makeSource(800, 1200);
    const out = await composeBrandedBuffer({
      sourceBuffer: src,
      reference: "G208A",
      size: "large",
      minWidth: 1000,
    });
    const meta = await sharp(out).metadata();
    expect(meta.width ?? 0).toBeGreaterThanOrEqual(1000);
    // Hauteur préservée en ratio : 1200 * (1000/800) = 1500
    expect(meta.height ?? 0).toBeGreaterThanOrEqual(1400);
  });

  it("upscale une source portrait 600×900 à minWidth 500 (Ankorstore, portrait)", async () => {
    const src = await makeSource(600, 900);
    const out = await composeBrandedBuffer({
      sourceBuffer: src,
      reference: "REF",
      size: "large",
      minWidth: 500,
    });
    const meta = await sharp(out).metadata();
    // 600 ≥ 500 → pas d'upscale, largeur reste 600 (déjà conforme).
    expect(meta.width ?? 0).toBeGreaterThanOrEqual(500);
  });

  it("sans minWidth : comportement historique préservé (petite source → 600 min)", async () => {
    const src = await makeSource(400, 400);
    const out = await composeBrandedBuffer({
      sourceBuffer: src,
      reference: "REF",
      size: "large",
    });
    const meta = await sharp(out).metadata();
    expect(meta.width ?? 0).toBeGreaterThanOrEqual(600);
  });
});
