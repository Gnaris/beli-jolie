/**
 * Tests pour lib/marketplace-image.ts
 *
 * Vérifie que la fonction d'upscale ne retouche pas les images déjà ≥ 500px
 * et garantit la largeur minimale pour les plus petites, sans déformer le
 * ratio ni introduire de flou (resize Lanczos3 + WebP lossless).
 */
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  buildFaireImageUrl,
  buildMarketplaceImageUrl,
  ensureMinDimensions,
  ensureMinWidth,
  guessContentType,
  MIN_MARKETPLACE_HEIGHT,
  MIN_MARKETPLACE_WIDTH,
} from "@/lib/marketplace-image";

async function makeTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  })
    .webp({ lossless: true })
    .toBuffer();
}

describe("lib/marketplace-image", () => {
  describe("MIN_MARKETPLACE_WIDTH", () => {
    it("is set to 500 (Ankorstore requirement)", () => {
      expect(MIN_MARKETPLACE_WIDTH).toBe(500);
    });
  });

  describe("buildMarketplaceImageUrl", () => {
    it("builds a URL pointing at the marketplace-image proxy route", () => {
      const url = buildMarketplaceImageUrl(
        "/uploads/produits/abc/abc-1.webp",
        "https://example.com",
      );
      expect(url).toBe(
        "https://example.com/api/marketplace-image?path=%2Fuploads%2Fproduits%2Fabc%2Fabc-1.webp",
      );
    });

    it("adds the leading slash to the path if missing", () => {
      const url = buildMarketplaceImageUrl(
        "uploads/produits/abc/abc-1.webp",
        "https://example.com",
      );
      expect(url).toContain("path=%2Fuploads%2Fproduits%2Fabc%2Fabc-1.webp");
    });

    it("URL-encodes accents and special characters in the path", () => {
      const url = buildMarketplaceImageUrl(
        "/uploads/produits/ref/ref-doré-1.webp",
        "https://example.com",
      );
      expect(url).toContain("dor%C3%A9");
    });

    it("strips trailing slash from the base", () => {
      const url = buildMarketplaceImageUrl(
        "/uploads/a.webp",
        "https://example.com/",
      );
      expect(url.startsWith("https://example.com/api/marketplace-image")).toBe(true);
    });
  });

  describe("ensureMinWidth", () => {
    it("returns the original buffer untouched when width >= 500", async () => {
      const input = await makeTestImage(800, 600);
      const result = await ensureMinWidth(input, 500);
      expect(result.resized).toBe(false);
      expect(result.buffer).toBe(input);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("returns the original buffer untouched when width === minWidth", async () => {
      const input = await makeTestImage(500, 500);
      const result = await ensureMinWidth(input, 500);
      expect(result.resized).toBe(false);
      expect(result.buffer).toBe(input);
    });

    it("upscales an image whose width is below the minimum", async () => {
      const input = await makeTestImage(400, 300);
      const result = await ensureMinWidth(input, 500);
      expect(result.resized).toBe(true);
      expect(result.width).toBe(500);

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(500);
      expect(meta.format).toBe("webp");
    });

    it("preserves aspect ratio when upscaling", async () => {
      // 400×600 → ratio 2/3. À 500px de large, la hauteur doit être 750.
      const input = await makeTestImage(400, 600);
      const result = await ensureMinWidth(input, 500);
      expect(result.resized).toBe(true);
      expect(result.width).toBe(500);
      expect(result.height).toBe(750);

      const meta = await sharp(result.buffer).metadata();
      expect(meta.width).toBe(500);
      expect(meta.height).toBe(750);
    });

    it("upscales a square 400px image to exactly 500×500", async () => {
      const input = await makeTestImage(400, 400);
      const result = await ensureMinWidth(input, 500);
      expect(result.resized).toBe(true);
      expect(result.width).toBe(500);
      expect(result.height).toBe(500);
    });

    it("produces a lossless WebP for upscaled images (no compression artifacts)", async () => {
      const input = await makeTestImage(400, 400);
      const result = await ensureMinWidth(input, 500);
      const meta = await sharp(result.buffer).metadata();
      expect(meta.format).toBe("webp");
      // Lossless WebP : la palette est conservée fidèlement
      const { dominant } = await sharp(result.buffer).stats();
      expect(dominant.r).toBeGreaterThanOrEqual(190);
      expect(dominant.r).toBeLessThanOrEqual(210);
      expect(dominant.g).toBeGreaterThanOrEqual(90);
      expect(dominant.g).toBeLessThanOrEqual(110);
      expect(dominant.b).toBeGreaterThanOrEqual(40);
      expect(dominant.b).toBeLessThanOrEqual(60);
    });

    it("respects a custom minWidth", async () => {
      const input = await makeTestImage(300, 300);
      const result = await ensureMinWidth(input, 600);
      expect(result.resized).toBe(true);
      expect(result.width).toBe(600);
      expect(result.height).toBe(600);
    });

    it("uses the default minWidth (500) when none provided", async () => {
      const input = await makeTestImage(400, 400);
      const result = await ensureMinWidth(input);
      expect(result.resized).toBe(true);
      expect(result.width).toBe(500);
    });
  });

  describe("MIN_MARKETPLACE_HEIGHT", () => {
    it("is set to 500 (Ankorstore requirement)", () => {
      expect(MIN_MARKETPLACE_HEIGHT).toBe(500);
    });
  });

  describe("ensureMinDimensions", () => {
    it("returns the original buffer when both dimensions ≥ 500", async () => {
      const input = await makeTestImage(800, 600);
      const result = await ensureMinDimensions(input, 500, 500);
      expect(result.resized).toBe(false);
      expect(result.buffer).toBe(input);
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
    });

    it("upscales a landscape image whose height is below the minimum", async () => {
      // 800×339 (Issyma incident) : la largeur passe déjà mais la hauteur non.
      const input = await makeTestImage(800, 339);
      const result = await ensureMinDimensions(input, 500, 500);
      expect(result.resized).toBe(true);
      // Le facteur d'agrandissement se calcule sur la petite dimension :
      // scale = max(500/800, 500/339) = 500/339 ≈ 1.475
      // → width = 800 × 1.475 ≈ 1180, height = 500
      expect(result.height).toBe(500);
      expect(result.width).toBeGreaterThanOrEqual(1180);

      const meta = await sharp(result.buffer).metadata();
      expect(meta.height).toBe(500);
      expect(meta.format).toBe("webp");
    });

    it("upscales a portrait image whose width is below the minimum", async () => {
      // Cas symétrique : 300×700 → scale = 500/300 = 1.666..
      const input = await makeTestImage(300, 700);
      const result = await ensureMinDimensions(input, 500, 500);
      expect(result.resized).toBe(true);
      expect(result.width).toBe(500);
      expect(result.height).toBeGreaterThanOrEqual(1166);
    });

    it("upscales when both dimensions are below the minimum", async () => {
      const input = await makeTestImage(300, 200);
      const result = await ensureMinDimensions(input, 500, 500);
      expect(result.resized).toBe(true);
      // scale = max(500/300, 500/200) = 2.5 → 750×500
      expect(result.width).toBeGreaterThanOrEqual(750);
      expect(result.height).toBe(500);
    });

    it("preserves aspect ratio during upscale", async () => {
      const input = await makeTestImage(600, 400);
      const result = await ensureMinDimensions(input, 500, 500);
      expect(result.resized).toBe(true);
      // scale = max(500/600, 500/400) = 1.25 → 750×500
      expect(result.width).toBe(750);
      expect(result.height).toBe(500);
    });

    it("ensureMinWidth remains backward compatible (no height constraint)", async () => {
      // Avant le fix : une image 800×339 était renvoyée telle quelle car la
      // largeur est ≥ 500. Le vieux comportement doit rester (l'appelant Faire
      // ne veut pas de contrainte hauteur — il gère lui-même).
      const input = await makeTestImage(800, 339);
      const result = await ensureMinWidth(input, 500);
      expect(result.resized).toBe(false);
      expect(result.width).toBe(800);
      expect(result.height).toBe(339);
    });
  });

  describe("buildFaireImageUrl", () => {
    it("adds format=jpeg & minWidth=1000 & minHeight=1000", () => {
      const url = buildFaireImageUrl(
        "/uploads/produits/abc/abc-1.webp",
        "https://example.com",
      );
      expect(url).toContain("format=jpeg");
      expect(url).toContain("minWidth=1000");
      expect(url).toContain("minHeight=1000");
    });
  });

  describe("guessContentType", () => {
    it("returns image/webp for .webp", () => {
      expect(guessContentType("/uploads/x.webp")).toBe("image/webp");
      expect(guessContentType("/UPLOADS/X.WEBP")).toBe("image/webp");
    });

    it("returns image/jpeg for .jpg and .jpeg", () => {
      expect(guessContentType("/uploads/x.jpg")).toBe("image/jpeg");
      expect(guessContentType("/uploads/x.jpeg")).toBe("image/jpeg");
    });

    it("returns image/png for .png", () => {
      expect(guessContentType("/uploads/x.png")).toBe("image/png");
    });

    it("returns image/gif for .gif", () => {
      expect(guessContentType("/uploads/x.gif")).toBe("image/gif");
    });

    it("falls back to application/octet-stream for unknown extensions", () => {
      expect(guessContentType("/uploads/x.tiff")).toBe("application/octet-stream");
      expect(guessContentType("/uploads/noext")).toBe("application/octet-stream");
    });
  });
});
