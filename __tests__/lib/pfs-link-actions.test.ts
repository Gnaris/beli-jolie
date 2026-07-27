/**
 * Tests unitaires des server actions de liaison PFS (preview/link/unlink).
 *
 * Tous les appels Prisma + l'API PFS sont mockés. On vérifie :
 *   - le matching auto local color → variante PFS par nom normalisé
 *   - la validation des doublons (1 variante PFS = 1 ProductColor BJ)
 *   - le pré-remplissage des liens existants à la réouverture
 *   - le comportement de removePfsMatch (efface produit + variantes)
 *   - le warning non bloquant si la sync post-liaison échoue
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks externes ──────────────────────────────────────────────
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "u", role: "ADMIN", status: "APPROVED", email: "a@b.c" },
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const pfsApiMock = {
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
};
vi.mock("@/lib/pfs-api", () => pfsApiMock);

const pfsUpdateMock = {
  pfsUpdateProductInPlace: vi.fn().mockResolvedValue({ success: true, archived: false }),
};
vi.mock("@/lib/pfs-update", () => pfsUpdateMock);

// Prisma : on contrôle finement ce que chaque modèle renvoie.
const prismaMock: any = {
  product: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  productColor: {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    update: vi.fn().mockResolvedValue({}),
  },
  productColorImage: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  color: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
};
prismaMock.$transaction = vi.fn(async (fn: any) => {
  if (typeof fn === "function") return fn(prismaMock);
  return Promise.all(fn);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Import APRÈS les mocks
const { previewPfsMatchByReference, linkPfsProductManually, removePfsMatch } =
  await import("@/app/actions/admin/pfs");

beforeEach(() => {
  for (const m of Object.values(prismaMock)) {
    if (typeof m === "object" && m !== null) {
      for (const fn of Object.values(m)) {
        if (typeof fn === "function" && "mockReset" in fn) {
          (fn as any).mockReset();
        }
      }
    }
  }
  prismaMock.$transaction.mockImplementation(async (fn: any) => {
    if (typeof fn === "function") return fn(prismaMock);
    return Promise.all(fn);
  });
  prismaMock.productColor.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.color.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.productColor.update.mockResolvedValue({});
  prismaMock.product.update.mockResolvedValue({});
  prismaMock.productColorImage.findMany.mockResolvedValue([]);
  pfsApiMock.pfsCheckReference.mockReset();
  pfsApiMock.pfsGetVariants.mockReset();
  pfsUpdateMock.pfsUpdateProductInPlace.mockReset();
  pfsUpdateMock.pfsUpdateProductInPlace.mockResolvedValue({ success: true, archived: false });
});

function buildBjProduct(overrides: Partial<any> = {}) {
  return {
    id: "p1",
    reference: "A2415",
    name: "Bracelet doré",
    pfsProductId: null,
    pfsBrandId: null,
    pfsBrandName: null,
    colors: [
      {
        id: "pc-or",
        saleType: "UNIT",
        unitPrice: { toString: () => "12.50" } as any,
        stock: 10,
        pfsVariantId: null,
        color: {
          id: "c-or",
          name: "Doré",
          hex: "#C9A961",
          patternImage: null,
          pfsColorRef: null,
        },
        images: [{ path: "/uploads/produits/A2415_or-1.webp" }],
        variantSizes: [],
      },
      {
        id: "pc-arg",
        saleType: "UNIT",
        unitPrice: { toString: () => "12.50" } as any,
        stock: 5,
        pfsVariantId: null,
        color: {
          id: "c-arg",
          name: "Argenté",
          hex: "#C0C0C0",
          patternImage: null,
          pfsColorRef: null,
        },
        images: [],
        variantSizes: [],
      },
    ],
    ...overrides,
  };
}

function buildPfsCheckResponse(productId = "pfs-prod-1") {
  return {
    exists: true,
    product: {
      id: productId,
      brand: { id: "brand-1", name: "Belicia" },
      gender: { reference: "WOMAN" },
      family: { id: "f1", reference: "BIJOUX" },
      category: { id: "c1", reference: "BRACELET" },
      reference: "A2415",
      label: { fr: "Bracelet doré", en: "Golden bracelet" },
      material_composition: [],
      lining_composition: [],
      country_of_manufacture: "CN",
      description: { fr: "Joli bracelet" },
      status: "ACTIVE",
      default_color: "GOLDEN",
      images: { main: "https://pfs/img/main.jpg" },
      flash_sales_discount: null,
    },
  };
}

function buildPfsVariants() {
  return {
    data: [
      {
        id: "pfs-vid-or",
        product_id: "pfs-prod-1",
        reference: "A2415",
        sku_suffix: "OR",
        type: "ITEM" as const,
        custom_suffix: "",
        pieces: 1,
        price_sale: {
          unit: { value: 15.0, currency: "EUR" },
          total: { value: 15.0, currency: "EUR" },
        },
        price_before_discount: {
          unit: { value: 15.0, currency: "EUR" },
          total: { value: 15.0, currency: "EUR" },
        },
        discount: null,
        item: {
          color: {
            id: 78,
            reference: "GOLDEN",
            value: "#C9A961",
            image: null,
            labels: { fr: "Doré", en: "Golden" },
          },
          size: "TU",
        },
        is_active: true,
        is_star: false,
        in_stock: true,
        stock_qty: 8,
        weight: 0.05,
        creation_date: "2026-01-01",
        size_details_tu: "",
        colors: [],
        images: { main: "https://pfs/img/or.jpg" },
      },
      {
        id: "pfs-vid-arg",
        product_id: "pfs-prod-1",
        reference: "A2415",
        sku_suffix: "ARG",
        type: "ITEM" as const,
        custom_suffix: "",
        pieces: 1,
        price_sale: {
          unit: { value: 15.0, currency: "EUR" },
          total: { value: 15.0, currency: "EUR" },
        },
        price_before_discount: {
          unit: { value: 15.0, currency: "EUR" },
          total: { value: 15.0, currency: "EUR" },
        },
        discount: null,
        item: {
          color: {
            id: 22,
            reference: "SILVER",
            value: "#C0C0C0",
            image: null,
            labels: { fr: "ARGENTE", en: "Silver" },
          },
          size: "TU",
        },
        is_active: true,
        is_star: false,
        in_stock: true,
        stock_qty: 3,
        weight: 0.05,
        creation_date: "2026-01-01",
        size_details_tu: "",
        colors: [],
        images: {},
      },
    ],
  };
}

describe("previewPfsMatchByReference", () => {
  it("renvoie une erreur si le produit BJ est introuvable", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(null);
    const res = await previewPfsMatchByReference("p-missing");
    expect(res).toEqual({ success: false, error: "Produit introuvable." });
  });

  it("renvoie une erreur si la référence PFS n'existe pas (404)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    pfsApiMock.pfsCheckReference.mockResolvedValueOnce({ exists: false });
    const res = await previewPfsMatchByReference("p1", "INTROUVABLE");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/INTROUVABLE/);
  });

  it("renvoie une erreur explicite si l'API PFS lève un 404", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    pfsApiMock.pfsCheckReference.mockRejectedValueOnce(new Error("PFS API 404: not found"));
    const res = await previewPfsMatchByReference("p1", "FOO");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/FOO/);
  });

  it("suggère le bon mapping local color → variante PFS par nom normalisé", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    pfsApiMock.pfsCheckReference.mockResolvedValueOnce(buildPfsCheckResponse());
    pfsApiMock.pfsGetVariants.mockResolvedValueOnce(buildPfsVariants());

    const res = await previewPfsMatchByReference("p1", "A2415");
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.pfsProductId).toBe("pfs-prod-1");
    expect(res.data.pfsProductName).toBe("Bracelet doré");
    expect(res.data.pfsBrandName).toBe("Belicia");

    // 2 candidates, 2 local colors, suggestion attendue : Doré→OR, Argenté→ARG
    expect(res.data.candidates).toHaveLength(2);
    const orCand = res.data.candidates.find((c) => c.pfsVariantId === "pfs-vid-or");
    const argCand = res.data.candidates.find((c) => c.pfsVariantId === "pfs-vid-arg");
    expect(orCand?.suggestedLocalColorId).toBe("pc-or");
    expect(argCand?.suggestedLocalColorId).toBe("pc-arg");
  });

  it("pré-remplit existingLinks depuis ProductColor.pfsVariantId déjà en BDD", async () => {
    const product = buildBjProduct();
    product.colors[0].pfsVariantId = "pfs-vid-or"; // déjà liée
    product.pfsProductId = "pfs-prod-1";
    prismaMock.product.findUnique.mockResolvedValueOnce(product);
    pfsApiMock.pfsCheckReference.mockResolvedValueOnce(buildPfsCheckResponse());
    pfsApiMock.pfsGetVariants.mockResolvedValueOnce(buildPfsVariants());

    const res = await previewPfsMatchByReference("p1", "A2415");
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.alreadyLinked).toBe(true);
    expect(res.data.existingLinks).toEqual({ "pc-or": "pfs-vid-or" });
  });

  it("fallback image : une couleur sans photo réutilise l'image d'une autre couleur du produit", async () => {
    // Régression : avant le fix, une couleur BJ sans image renvoyait productImage:null.
    // Résultat : la modale affichait « Pas d'image » côté « Notre Boutique » même
    // quand une autre couleur du même produit avait une photo utilisable.
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    // Table ProductColorImage : l'image de pc-or au niveau (productId, colorId).
    prismaMock.productColorImage.findMany.mockResolvedValueOnce([
      { colorId: "c-or", path: "/uploads/produits/A2415_or-1.webp" },
    ]);
    pfsApiMock.pfsCheckReference.mockResolvedValueOnce(buildPfsCheckResponse());
    pfsApiMock.pfsGetVariants.mockResolvedValueOnce(buildPfsVariants());

    const res = await previewPfsMatchByReference("p1", "A2415");
    expect(res.success).toBe(true);
    if (!res.success) return;

    // pc-or a l'image via pc.images, pc-arg récupère l'image de pc-or via
    // le fallback allProductImages.
    const or = res.data.localColors.find((c) => c.productColorId === "pc-or");
    const arg = res.data.localColors.find((c) => c.productColorId === "pc-arg");
    expect(or?.productImage).toBe("/uploads/produits/A2415_or-1.webp");
    expect(arg?.productImage).toBe("/uploads/produits/A2415_or-1.webp");
  });

  it("fallback image niveau produit : image orpheline sans ProductColor liée (cas E841C)", async () => {
    // Cas réel E841C : images stockées dans ProductColorImage avec
    // productColorId=NULL. Le include Prisma `pc.images` les ignore. Sans
    // le fix, la modale affichait « Aucune photo côté boutique ».
    const product = buildBjProduct();
    product.colors[0].images = [];
    product.colors[1].images = [];
    prismaMock.product.findUnique.mockResolvedValueOnce(product);
    prismaMock.productColorImage.findMany.mockResolvedValueOnce([
      { colorId: "c-or", path: "/uploads/produits/E841C-1.webp" },
    ]);
    pfsApiMock.pfsCheckReference.mockResolvedValueOnce(buildPfsCheckResponse());
    pfsApiMock.pfsGetVariants.mockResolvedValueOnce(buildPfsVariants());

    const res = await previewPfsMatchByReference("p1", "A2415");
    expect(res.success).toBe(true);
    if (!res.success) return;
    for (const lc of res.data.localColors) {
      expect(lc.productImage).toBe("/uploads/produits/E841C-1.webp");
    }
  });

  it("propose les couleurs PACK ET UNIT (PFS gère les deux types)", async () => {
    const product = buildBjProduct({
      colors: [
        {
          id: "pc-pack",
          saleType: "PACK",
          unitPrice: { toString: () => "29.90" } as any,
          stock: 4,
          pfsVariantId: null,
          color: {
            id: "c-mix",
            name: "Doré",
            hex: "#C9A961",
            patternImage: null,
            pfsColorRef: null,
          },
          images: [],
          variantSizes: [],
        },
      ],
    });
    prismaMock.product.findUnique.mockResolvedValueOnce(product);
    pfsApiMock.pfsCheckReference.mockResolvedValueOnce(buildPfsCheckResponse());
    pfsApiMock.pfsGetVariants.mockResolvedValueOnce(buildPfsVariants());

    const res = await previewPfsMatchByReference("p1", "A2415");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.localColors).toHaveLength(1);
    expect(res.data.localColors[0].saleType).toBe("PACK");
  });
});

describe("linkPfsProductManually", () => {
  it("refuse les doublons de pfsVariantId", async () => {
    const res = await linkPfsProductManually("p1", "pfs-prod-1", null, [
      { productColorId: "pc-or", pfsVariantId: "X" },
      { productColorId: "pc-arg", pfsVariantId: "X" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/plusieurs fois/);
  });

  it("refuse les doublons de productColorId", async () => {
    const res = await linkPfsProductManually("p1", "pfs-prod-1", null, [
      { productColorId: "pc-or", pfsVariantId: "X" },
      { productColorId: "pc-or", pfsVariantId: "Y" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/plusieurs variantes PFS/);
  });

  it("refuse un pfsProductId vide", async () => {
    const res = await linkPfsProductManually("p1", "", null, [
      { productColorId: "pc-or", pfsVariantId: "X" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/vide/);
  });

  it("refuse les liens vides", async () => {
    const res = await linkPfsProductManually("p1", "pfs-prod-1", null, []);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Aucune couleur/);
  });

  it("refuse si une ProductColor n'appartient pas au produit", async () => {
    prismaMock.productColor.findMany.mockResolvedValueOnce([
      { id: "pc-or", colorId: "c-or" },
      // missing pc-arg
    ]);
    const res = await linkPfsProductManually("p1", "pfs-prod-1", null, [
      { productColorId: "pc-or", pfsVariantId: "X" },
      { productColorId: "pc-arg", pfsVariantId: "Y" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/n'appartiennent pas/);
  });

  it("écrit pfsProductId + pfsVariantId + lance la sync best-effort", async () => {
    prismaMock.productColor.findMany.mockResolvedValueOnce([
      { id: "pc-or", colorId: "c-or" },
    ]);
    pfsUpdateMock.pfsUpdateProductInPlace.mockResolvedValueOnce({
      success: true,
      archived: false,
    });

    const res = await linkPfsProductManually(
      "p1",
      "pfs-prod-1",
      { id: "brand-1", name: "Belicia" },
      [{ productColorId: "pc-or", pfsVariantId: "pfs-vid-or", pfsColorRef: "GOLDEN" }],
    );

    expect(res.success).toBe(true);
    expect(res.linked).toBe(1);
    expect(res.syncWarning).toBeUndefined();
    expect(prismaMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          pfsProductId: "pfs-prod-1",
          pfsBrandId: "brand-1",
          pfsBrandName: "Belicia",
          pfsSyncRequired: false,
        }),
      }),
    );
    expect(prismaMock.productColor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "p1" },
        data: { pfsVariantId: null },
      }),
    );
    expect(prismaMock.productColor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pc-or" },
        data: { pfsVariantId: "pfs-vid-or" },
      }),
    );
    expect(pfsUpdateMock.pfsUpdateProductInPlace).toHaveBeenCalledWith(
      "p1",
      undefined,
      { forceFullSync: true },
    );
  });

  it("remonte un syncWarning si la sync post-liaison échoue", async () => {
    prismaMock.productColor.findMany.mockResolvedValueOnce([
      { id: "pc-or", colorId: "c-or" },
    ]);
    pfsUpdateMock.pfsUpdateProductInPlace.mockResolvedValueOnce({
      success: false,
      error: "PFS 502",
    });

    const res = await linkPfsProductManually("p1", "pfs-prod-1", null, [
      { productColorId: "pc-or", pfsVariantId: "pfs-vid-or" },
    ]);

    expect(res.success).toBe(true);
    expect(res.syncWarning).toBe("PFS 502");
  });
});

describe("removePfsMatch", () => {
  it("efface pfsProductId + brand + tous les pfsVariantId", async () => {
    const res = await removePfsMatch("p1");
    expect(res.success).toBe(true);
    expect(prismaMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          pfsProductId: null,
          pfsBrandId: null,
          pfsBrandName: null,
          pfsSyncRequired: false,
        }),
      }),
    );
    expect(prismaMock.productColor.updateMany).toHaveBeenCalledWith({
      where: { productId: "p1" },
      data: { pfsVariantId: null },
    });
  });
});
