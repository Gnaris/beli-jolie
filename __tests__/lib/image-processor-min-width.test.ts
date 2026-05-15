/**
 * Vérifie que processProductImage agrandit les images dont la source fait
 * moins de MIN_LARGE_WIDTH (600px) à au moins 600px sur la version "large".
 * Ankorstore exige minimum 500px.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const writes = new Map<string, Buffer>();

vi.mock("@/lib/storage", () => ({
  uploadFile: vi.fn(async (key: string, buf: Buffer) => {
    writes.set(key, buf);
  }),
  keyPrefixFromDestDir: (dir: string) =>
    dir.replace(/^public\//, "").replace(/^\/+/, "").replace(/\/+$/, ""),
}));

import { processProductImage, MIN_LARGE_WIDTH } from "@/lib/image-processor";

async function makeWebp(width: number, height: number): Promise<Buffer> {
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

describe("processProductImage — minimum width", () => {
  beforeEach(() => {
    writes.clear();
  });

  it("agrandit une image source 450x450 a 600x600 (large)", async () => {
    const src = await makeWebp(450, 450);
    const result = await processProductImage(src, "uploads/produits/test", "ref-rouge-1");

    expect(result.dbPath).toBe("/uploads/produits/test/ref-rouge-1.webp");
    const largeBuf = writes.get("uploads/produits/test/ref-rouge-1.webp");
    expect(largeBuf).toBeDefined();
    const meta = await sharp(largeBuf!).metadata();
    expect(meta.width).toBeGreaterThanOrEqual(MIN_LARGE_WIDTH);
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(600);
  });

  it("agrandit une image rectangulaire 450x300 (cote court < seuil)", async () => {
    const src = await makeWebp(450, 300);
    await processProductImage(src, "uploads/produits/test", "ref-bleu-1");

    const largeBuf = writes.get("uploads/produits/test/ref-bleu-1.webp");
    const meta = await sharp(largeBuf!).metadata();
    // fit "inside" + carre 600x600 → la plus grande dimension monte a 600
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeGreaterThanOrEqual(MIN_LARGE_WIDTH);
  });

  it("ne touche pas une image source 1500x1500 (au-dessus du max large 1200)", async () => {
    const src = await makeWebp(1500, 1500);
    await processProductImage(src, "uploads/produits/test", "ref-noir-1");

    const largeBuf = writes.get("uploads/produits/test/ref-noir-1.webp");
    const meta = await sharp(largeBuf!).metadata();
    // Limite a 1200x1200 par fit:inside, withoutEnlargement n'agit pas
    expect(meta.width).toBe(1200);
  });

  it("preserve une image source 800x800 (entre seuil et max)", async () => {
    const src = await makeWebp(800, 800);
    await processProductImage(src, "uploads/produits/test", "ref-vert-1");

    const largeBuf = writes.get("uploads/produits/test/ref-vert-1.webp");
    const meta = await sharp(largeBuf!).metadata();
    expect(meta.width).toBe(800);
  });
});
