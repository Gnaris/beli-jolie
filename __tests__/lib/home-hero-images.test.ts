/**
 * Tests unitaires de `lib/home-hero-images.ts` : sélection stable-par-jour
 * d'images produit pour le fond décoratif du hero BJ.
 *
 * Couvre :
 *   1. Ignore les couleurs sans stock / disabled (règle vitrine publique).
 *   2. Ignore les rows ProductColorImage sans colorId.
 *   3. Ignore les paths dont le fichier n'existe pas sur disque.
 *   4. Retourne au plus 60 images.
 *   5. Retour vide si aucun produit vendable.
 *   6. Tirage déterministe pour un même jour + tenant (même seed → même ordre).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock: any = {
  product: { findMany: vi.fn() },
  productColorImage: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// existsSync : par défaut on répond « le fichier existe » — les tests qui
// veulent tester le filet disque ré-écrasent le mock au coup par coup.
const existsSyncMock = vi.fn().mockReturnValue(true);
vi.mock("fs", () => ({ existsSync: (p: string) => existsSyncMock(p) }));

// tenantScopedCacheWithTid : on le neutralise pour ne pas dépendre de
// next/cache dans les tests (l'unité qu'on teste est pickHomeHeroImagesImpl).
vi.mock("@/lib/cached-data", () => ({
  tenantScopedCacheWithTid: (_k: string, fn: any) => fn,
}));

const { pickHomeHeroImagesImpl } = await import("@/lib/home-hero-images");

beforeEach(() => {
  prismaMock.product.findMany.mockReset();
  prismaMock.productColorImage.findMany.mockReset();
  existsSyncMock.mockReset();
  existsSyncMock.mockReturnValue(true);
});

describe("pickHomeHeroImagesImpl", () => {
  it("retourne [] si aucun produit vendable", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const out = await pickHomeHeroImagesImpl("t1");
    expect(out).toEqual([]);
    expect(prismaMock.productColorImage.findMany).not.toHaveBeenCalled();
  });

  it("ne remonte que les images des couleurs vendables du produit", async () => {
    // Produit p1 : couleur c-red vendable (dans le where), couleur c-blue
    // filtrée en amont par Prisma (stock=0). L'image liée à c-blue ne doit
    // PAS remonter même si elle existe encore en BDD.
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p1", colors: [{ colorId: "c-red" }] },
    ]);
    prismaMock.productColorImage.findMany.mockResolvedValue([
      { productId: "p1", colorId: "c-red", path: "/uploads/x/red.webp" },
      { productId: "p1", colorId: "c-blue", path: "/uploads/x/blue.webp" },
    ]);
    const out = await pickHomeHeroImagesImpl("t1");
    expect(out).toEqual(["/uploads/x/red.webp"]);
  });

  it("ignore les rows sans colorId", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p1", colors: [{ colorId: "c-red" }] },
    ]);
    prismaMock.productColorImage.findMany.mockResolvedValue([
      { productId: "p1", colorId: null, path: "/uploads/x/orphan.webp" },
      { productId: "p1", colorId: "c-red", path: "/uploads/x/red.webp" },
    ]);
    const out = await pickHomeHeroImagesImpl("t1");
    expect(out).toEqual(["/uploads/x/red.webp"]);
  });

  it("dédoublonne à une image par (produit, couleur) — la première dans l'order", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p1", colors: [{ colorId: "c-red" }] },
    ]);
    // Prisma a déjà trié par order asc → la 1ʳᵉ ligne est l'image principale.
    prismaMock.productColorImage.findMany.mockResolvedValue([
      { productId: "p1", colorId: "c-red", path: "/uploads/x/main.webp" },
      { productId: "p1", colorId: "c-red", path: "/uploads/x/second.webp" },
    ]);
    const out = await pickHomeHeroImagesImpl("t1");
    expect(out).toEqual(["/uploads/x/main.webp"]);
  });

  it("filtre les paths dont le fichier n'existe pas sur disque", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p1", colors: [{ colorId: "c-a" }] },
      { id: "p2", colors: [{ colorId: "c-b" }] },
    ]);
    prismaMock.productColorImage.findMany.mockResolvedValue([
      { productId: "p1", colorId: "c-a", path: "/uploads/x/missing.webp" },
      { productId: "p2", colorId: "c-b", path: "/uploads/x/present.webp" },
    ]);
    existsSyncMock.mockImplementation((p: string) => p.includes("present"));
    const out = await pickHomeHeroImagesImpl("t1");
    expect(out).toEqual(["/uploads/x/present.webp"]);
  });

  it("cap à 60 images maximum", async () => {
    const products = Array.from({ length: 80 }, (_, i) => ({
      id: `p${i}`,
      colors: [{ colorId: `c${i}` }],
    }));
    const rows = products.map((p) => ({
      productId: p.id,
      colorId: p.colors[0].colorId,
      path: `/uploads/x/${p.id}.webp`,
    }));
    prismaMock.product.findMany.mockResolvedValue(products);
    prismaMock.productColorImage.findMany.mockResolvedValue(rows);
    const out = await pickHomeHeroImagesImpl("t1");
    expect(out).toHaveLength(60);
  });

  it("tirage déterministe pour un même tenant + jour", async () => {
    const products = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      colors: [{ colorId: `c${i}` }],
    }));
    const rows = products.map((p) => ({
      productId: p.id,
      colorId: p.colors[0].colorId,
      path: `/uploads/x/${p.id}.webp`,
    }));
    prismaMock.product.findMany.mockResolvedValue(products);
    prismaMock.productColorImage.findMany.mockResolvedValue(rows);

    const a = await pickHomeHeroImagesImpl("t1");
    const b = await pickHomeHeroImagesImpl("t1");
    expect(a).toEqual(b);
  });
});
