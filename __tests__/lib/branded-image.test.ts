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

  it("change quand variant change (isolation cache profil standard vs large)", () => {
    const a = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large", 500, "standard");
    const b = computeBrandedHash("/uploads/x/produits/e310b/img.webp", "E310B", "large", 500, "large");
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
    expect(badge.y).toBeGreaterThanOrEqual(6);
    expect(badge.x).toBeGreaterThan(0);
    expect(badge.x).toBeLessThan(1200);
  });

  it("profil standard : badge à 40% de la largeur, min 160 / max 560", () => {
    const smallBadge = buildBadgeSvg("R1", 300);
    const smallW = Number(smallBadge.svg.toString().match(/width="(\d+)"/)?.[1]);
    // 300 × 40 % = 120 → clamp min 160 respecté
    expect(smallW).toBeGreaterThanOrEqual(160);

    const bigBadge = buildBadgeSvg("R1", 3000);
    const bigW = Number(bigBadge.svg.toString().match(/width="(\d+)"/)?.[1]);
    // 3000 × 40 % = 1200 → clamp max 560 respecté
    expect(bigW).toBeLessThanOrEqual(560);
  });

  it("profil large : badge à 50% de la largeur, min 200 / max 700, plus gros que standard", () => {
    const std = buildBadgeSvg("R1", 1000, "standard");
    const lrg = buildBadgeSvg("R1", 1000, "large");
    const stdW = Number(std.svg.toString().match(/width="(\d+)"/)?.[1]);
    const lrgW = Number(lrg.svg.toString().match(/width="(\d+)"/)?.[1]);
    // À 1000px : standard = 400, large = 500
    expect(stdW).toBe(400);
    expect(lrgW).toBe(500);
    expect(lrgW).toBeGreaterThan(stdW);
  });

  it("profil large : texte de la référence plus gros que standard", () => {
    const std = buildBadgeSvg("R1", 1000, "standard");
    const lrg = buildBadgeSvg("R1", 1000, "large");
    // Le 2ᵉ font-size dans le SVG correspond au bloc code (la référence).
    const stdFonts = [...std.svg.toString().matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    const lrgFonts = [...lrg.svg.toString().matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(lrgFonts[1]!).toBeGreaterThan(stdFonts[1]!);
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

  it("auto-fit : les longues références (14 chars) tiennent dans le badge", () => {
    // Bug 2026-08-06 : « PRT-OREILLE174 » débordait à droite du cadre.
    for (const imageWidth of [400, 800, 1200, 2000]) {
      for (const variant of ["standard", "large"] as const) {
        const badge = buildBadgeSvg("PRT-OREILLE174", imageWidth, variant);
        const svg = badge.svg.toString();
        const badgeWidth = Number(svg.match(/<svg[^>]*width="(\d+)"/)?.[1]);
        // 2e font-size = bloc code référence
        const fontSizes = [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
        const codeFontSize = fontSizes[1]!;
        // Largeur estimée du texte en monospace (0.6 × font-size par char).
        const estimatedTextWidth = 14 * codeFontSize * 0.6;
        // Doit tenir dans le badge avec un peu de marge (padding ~4 % × 2).
        const padTolerance = badgeWidth * 0.08;
        expect(estimatedTextWidth).toBeLessThanOrEqual(badgeWidth - padTolerance);
      }
    }
  });

  it("auto-fit : les courtes références gardent la police naturelle (grande)", () => {
    // On ne veut PAS écraser inutilement les refs courtes — seule la police
    // du bloc code doit rétrécir quand c'est nécessaire.
    const shortBadge = buildBadgeSvg("R1", 1000, "standard");
    const longBadge = buildBadgeSvg("PRT-OREILLE174", 1000, "standard");
    const shortCodeFont = Number(
      [...shortBadge.svg.toString().matchAll(/font-size="(\d+)"/g)][1]![1],
    );
    const longCodeFont = Number(
      [...longBadge.svg.toString().matchAll(/font-size="(\d+)"/g)][1]![1],
    );
    expect(shortCodeFont).toBeGreaterThan(longCodeFont);
  });

  it("auto-fit : hauteur du badge inchangée entre ref courte et ref longue (homogénéité visuelle)", () => {
    const shortBadge = buildBadgeSvg("R1", 1000, "standard");
    const longBadge = buildBadgeSvg("PRT-OREILLE174-XL", 1000, "standard");
    const shortHeight = Number(shortBadge.svg.toString().match(/<svg[^>]*height="(\d+)"/)?.[1]);
    const longHeight = Number(longBadge.svg.toString().match(/<svg[^>]*height="(\d+)"/)?.[1]);
    expect(shortHeight).toBe(longHeight);
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
