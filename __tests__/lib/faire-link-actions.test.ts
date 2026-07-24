/**
 * Tests unitaires des server actions de liaison Faire (preview/link/unlink).
 *
 * Tous les appels Prisma + l'API Faire (`faireFetch`) sont mockés. On vérifie :
 *   - la recherche par SKU + parsing de la réponse Faire
 *   - le matching auto local color → variante Faire par nom normalisé
 *   - le pré-remplissage des liens existants à la réouverture
 *   - le fallback "SKU local généré" quand aucun SKU n'est saisi
 *   - la sélection du produit PUBLISHED quand plusieurs matches
 *   - la validation des doublons (1 variante Faire = 1 ProductColor BJ)
 *   - le comportement de removeFaireMatch
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

// Faire API mock
const faireApiMock = {
  faireFetch: vi.fn(),
};
vi.mock("@/lib/faire-api", () => faireApiMock);

// Faire taxonomy (utilisé par d'autres exports)
vi.mock("@/lib/faire-taxonomy", () => ({
  getFaireTaxonomy: vi.fn().mockResolvedValue([]),
}));

// Faire update (post-link sync)
const faireUpdateMock = {
  faireUpdateProduct: vi.fn().mockResolvedValue({ success: true, noop: false, diff: {} }),
};
vi.mock("@/lib/faire-update", () => faireUpdateMock);

// Prisma
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
};
prismaMock.$transaction = vi.fn(async (fn: any) => {
  if (typeof fn === "function") return fn(prismaMock);
  return Promise.all(fn);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Import APRÈS les mocks
const { previewFaireMatchBySku, linkFaireProductManually, removeFaireMatch } =
  await import("@/app/actions/admin/faire");

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
  prismaMock.productColor.update.mockResolvedValue({});
  prismaMock.product.update.mockResolvedValue({});
  faireApiMock.faireFetch.mockReset();
  faireUpdateMock.faireUpdateProduct.mockReset();
  faireUpdateMock.faireUpdateProduct.mockResolvedValue({
    success: true,
    noop: false,
    diff: {},
  });
});

// ─── Builders BJ / Faire ──────────────────────────────────────────

function buildBjProduct(overrides: Partial<any> = {}) {
  return {
    id: "p1",
    reference: "F137",
    name: "Bague acier",
    faireProductId: null,
    colors: [
      {
        id: "pc-or",
        saleType: "UNIT",
        unitPrice: { toString: () => "12.50" },
        stock: 10,
        faireVariantId: null,
        color: {
          id: "c-or",
          name: "Doré",
          hex: "#C9A961",
          patternImage: null,
        },
        images: [{ path: "/uploads/produits/F137_or-1.webp" }],
      },
      {
        id: "pc-arg",
        saleType: "UNIT",
        unitPrice: { toString: () => "12.50" },
        stock: 5,
        faireVariantId: null,
        color: {
          id: "c-arg",
          name: "Argenté",
          hex: "#C0C0C0",
          patternImage: null,
        },
        images: [],
      },
    ],
    ...overrides,
  };
}

function mockFaireSearchOk(products: any[]) {
  faireApiMock.faireFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ products }),
    text: async () => JSON.stringify({ products }),
  });
}

function buildFaireProduct(overrides: Partial<any> = {}) {
  return {
    id: "p_abc123",
    name: "Bague acier",
    lifecycle_state: "PUBLISHED",
    images: [
      { url: "https://cdn.faire.com/main.jpg", sequence: 0 },
    ],
    variants: [
      {
        id: "po_or",
        sku: "f137_dore_UNIT_xxxx",
        name: "Doré",
        lifecycle_state: "PUBLISHED",
        available_quantity: 8,
        wholesale_price_cents: 750,
        retail_price_cents: 1500,
        options: [{ name: "Color", value: "Doré" }],
        images: [{ url: "https://cdn.faire.com/or.jpg", sequence: 0 }],
      },
      {
        id: "po_arg",
        sku: "f137_argente_UNIT_yyyy",
        name: "Argenté",
        lifecycle_state: "PUBLISHED",
        available_quantity: 3,
        wholesale_price_cents: 750,
        retail_price_cents: 1500,
        options: [{ name: "Color", value: "ARGENTE" }],
        images: [],
      },
    ],
    ...overrides,
  };
}

// ─── previewFaireMatchBySku ────────────────────────────────────────

describe("previewFaireMatchBySku", () => {
  it("renvoie une erreur si le produit BJ est introuvable", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(null);
    const res = await previewFaireMatchBySku("p-missing");
    expect(res).toEqual({ success: false, error: "Produit introuvable." });
  });

  it("retourne faireProductId=null + candidates=[] si aucun match Faire (SKU exact)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    // SKU complet (`_UNIT_`) → 1 seul appel API, pas de fallback
    mockFaireSearchOk([]); // 0 produit
    const res = await previewFaireMatchBySku("p1", "f137_inexistant_UNIT_zzzz");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.faireProductId).toBeNull();
    expect(res.data.candidates).toEqual([]);
    // Les couleurs locales sont quand même renvoyées pour l'UI
    expect(res.data.localColors).toHaveLength(2);
  });

  it("suggère le bon mapping local color → variante Faire par nom normalisé", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    mockFaireSearchOk([buildFaireProduct()]);

    const res = await previewFaireMatchBySku("p1", "f137_dore_UNIT_xxxx");
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.faireProductId).toBe("p_abc123");
    expect(res.data.faireLifecycleState).toBe("PUBLISHED");
    expect(res.data.candidates).toHaveLength(2);

    const orCand = res.data.candidates.find((c) => c.faireVariantId === "po_or");
    const argCand = res.data.candidates.find((c) => c.faireVariantId === "po_arg");
    // "Doré" match "Doré" (BJ)
    expect(orCand?.suggestedLocalColorId).toBe("pc-or");
    // "ARGENTE" → normalisé "argente" → matche "Argenté" → normalisé "argente" (BJ)
    expect(argCand?.suggestedLocalColorId).toBe("pc-arg");
  });

  it("pré-remplit existingLinks depuis ProductColor.faireVariantId déjà en BDD", async () => {
    const product = buildBjProduct();
    product.colors[0].faireVariantId = "po_or";
    product.faireProductId = "p_abc123";
    prismaMock.product.findUnique.mockResolvedValueOnce(product);
    mockFaireSearchOk([buildFaireProduct()]);

    const res = await previewFaireMatchBySku("p1", "f137_dore_UNIT_xxxx");
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.alreadyLinked).toBe(true);
    expect(res.data.existingLinks).toEqual({ "pc-or": "po_or" });
  });

  it("utilise la référence du produit quand l'input est vide (pré-rempli UI)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    // 3 SKUs candidats essayés en parallèle : F137 exact + 2 SKUs longs des
    // couleurs locales. Puis fallback scan car aucun ne matche.
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    mockFaireSearchOk([]); // scan préfixe page 1

    const res = await previewFaireMatchBySku("p1");
    expect(res.success).toBe(true);
    if (!res.success) return;

    // Le champ pré-rempli côté UI = la référence du produit, pas un SKU long
    expect(res.data.faireSkuInput).toBe("F137");
    // 1 SKU exact (référence) + 2 SKUs longs + 1 scan = 4 appels
    expect(faireApiMock.faireFetch).toHaveBeenCalledTimes(4);
    const urls = faireApiMock.faireFetch.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    // Le 1er appel cible la référence exacte, les 2 suivants les SKUs longs
    expect(urls[0]).toMatch(/sku=F137(&|$)/);
    expect(/sku=f137_.+_UNIT_/.test(urls[1])).toBe(true);
    expect(/sku=f137_.+_UNIT_/.test(urls[2])).toBe(true);
  });

  it("trouve un produit en essayant les SKUs locaux à partir d'une référence", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    // 3 candidats essayés en parallèle : ref exacte (vide) + Doré (trouve)
    // + Argenté (vide).
    mockFaireSearchOk([]);
    mockFaireSearchOk([buildFaireProduct()]);
    mockFaireSearchOk([]);

    const res = await previewFaireMatchBySku("p1", "F137");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.faireProductId).toBe("p_abc123");
    expect(res.data.candidates).toHaveLength(2);
  });

  it("trouve une fiche Faire créée à la main dont le SKU = la référence exacte", async () => {
    // Cas réel Issyma 93126 (2026-07-24) : la fiche Faire a été publiée avec
    // toutes ses variantes portant simplement `93126` comme SKU. Le format
    // long généré chez nous ne matche rien, mais l'essai « ref exacte »
    // (ajouté au même passage que les SKUs longs) doit trouver le produit.
    const bj = buildBjProduct({
      reference: "93126",
      colors: [
        {
          id: "pc-blanc",
          saleType: "UNIT",
          unitPrice: { toString: () => "10.00" },
          stock: 3,
          faireVariantId: null,
          color: { id: "c-blanc", name: "Blanc", hex: "#fff", patternImage: null },
          images: [],
        },
      ],
    });
    prismaMock.product.findUnique.mockResolvedValueOnce(bj);
    // 1er appel = SKU exact "93126" → trouve la fiche.
    mockFaireSearchOk([
      {
        id: "p_bwthbwqvta",
        name: "Robe longue en coton col chemise",
        lifecycle_state: "PUBLISHED",
        variants: [
          { id: "po_1", sku: "93126", options: [{ name: "Color", value: "Blanc" }] },
        ],
      },
    ]);
    // 2e appel = SKU long "93126_blanc_..." → vide (parallèle avec le 1er).
    mockFaireSearchOk([]);

    const res = await previewFaireMatchBySku("p1", "93126");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.faireProductId).toBe("p_bwthbwqvta");
    expect(res.data.candidates).toHaveLength(1);
  });

  it("suggère le mapping en se basant sur le SKU Faire (couvre 'Argenté' BJ ↔ 'argent' SKU)", async () => {
    // Cas réel observé sur F137 : côté Faire SKU = `f137_argent_UNIT_xxxx`,
    // côté BJ couleur = "Argenté" (avec accent). Le matching par nom strict
    // échouerait ; le matching par SKU doit réussir.
    const bj = buildBjProduct({
      colors: [
        {
          id: "pc-arg",
          saleType: "UNIT",
          unitPrice: { toString: () => "12.50" },
          stock: 5,
          faireVariantId: null,
          color: {
            id: "c-arg",
            name: "Argenté",
            hex: "#C0C0C0",
            patternImage: null,
          },
          images: [],
        },
      ],
    });
    prismaMock.product.findUnique.mockResolvedValueOnce(bj);
    // 2 candidats essayés en parallèle (ref exacte + 1 SKU long) → vides.
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    // Fallback scan préfixe → produit Faire avec SKU custom
    mockFaireSearchOk([
      {
        id: "p_live_f137",
        name: "Bague",
        lifecycle_state: "PUBLISHED",
        variants: [
          {
            id: "po_arg_remote",
            sku: "f137_argent_UNIT_btjq32q5",
            name: "Argent", // ≠ "Argenté"
            lifecycle_state: "PUBLISHED",
            options: [{ name: "Color", value: "Argent" }],
          },
        ],
      },
    ]);

    const res = await previewFaireMatchBySku("p1", "F137");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.faireProductId).toBe("p_live_f137");
    expect(res.data.candidates).toHaveLength(1);
    // ✅ Le mapping auto a fonctionné via le SKU couleur
    expect(res.data.candidates[0].suggestedLocalColorId).toBe("pc-arg");
  });

  it("réécrit les URLs cdn.faire.com vers notre proxy local (bypass bloqueurs)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    mockFaireSearchOk([
      {
        id: "p_faire",
        name: "Bague",
        lifecycle_state: "PUBLISHED",
        images: [{ url: "https://cdn.faire.com/fastly/abc.webp", sequence: 0 }],
        variants: [
          {
            id: "po_v1",
            sku: "f137_dor_UNIT_xxxx",
            options: [{ name: "Color", value: "Doré" }],
            images: [{ url: "https://cdn.faire.com/fastly/def.webp", sequence: 0 }],
          },
        ],
      },
    ]);

    const res = await previewFaireMatchBySku("p1", "f137_dor_UNIT_xxxx");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.faireProductImage).toBe(
      "/api/admin/faire-image-proxy?url=https%3A%2F%2Fcdn.faire.com%2Ffastly%2Fabc.webp",
    );
    expect(res.data.candidates[0].imageUrl).toBe(
      "/api/admin/faire-image-proxy?url=https%3A%2F%2Fcdn.faire.com%2Ffastly%2Fdef.webp",
    );
  });

  it("filtre les anciens existingLinks dont le faireVariantId n'existe plus dans la fiche trouvée", async () => {
    // Cas réel F137 : l'admin avait lié à une ancienne fiche Faire (supprimée
    // depuis). Les `ProductColor.faireVariantId` stockés pointent vers du
    // néant. La nouvelle recherche trouve une autre fiche avec des variantes
    // d'IDs différents — les anciens liens doivent être ignorés pour que
    // les suggestions auto s'appliquent.
    const bj = buildBjProduct();
    bj.colors[0].faireVariantId = "po_ANCIEN_disparu"; // ancien lien mort
    bj.colors[1].faireVariantId = "po_ANCIEN_disparu2";
    bj.faireProductId = "p_ANCIEN_supprime";
    prismaMock.product.findUnique.mockResolvedValueOnce(bj);
    mockFaireSearchOk([buildFaireProduct()]); // SKUs locaux essayés → trouve

    const res = await previewFaireMatchBySku("p1", "f137_dore_UNIT_xxxx");
    expect(res.success).toBe(true);
    if (!res.success) return;
    // ✅ Les anciens liens sont JETÉS (pas dans candidates de la nouvelle fiche)
    expect(res.data.existingLinks).toEqual({});
    // ✅ Les suggestions auto restent intactes, donc le client peut hydrater
    //    le mapping avec elles
    const orCand = res.data.candidates.find((c) => c.faireVariantId === "po_or");
    expect(orCand?.suggestedLocalColorId).toBe("pc-or");
  });

  it("utilise la 1ère image variante quand le produit Faire n'a pas d'image racine", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    // 3 candidats en parallèle (ref exacte + 2 SKUs longs) → tous vides
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    // Fallback scan : produit SANS images racine, mais variantes avec images
    mockFaireSearchOk([
      {
        id: "p_no_root_img",
        name: "Bague",
        lifecycle_state: "PUBLISHED",
        // Pas d'images racine
        variants: [
          {
            id: "po_v1",
            sku: "f137_dor_UNIT_xxxx",
            options: [{ name: "Color", value: "Doré" }],
            images: [{ url: "https://cdn.faire.com/variant1.webp", sequence: 0 }],
          },
        ],
      },
    ]);

    const res = await previewFaireMatchBySku("p1", "F137");
    expect(res.success).toBe(true);
    if (!res.success) return;
    // L'URL `cdn.faire.com` est réécrite vers notre proxy local
    expect(res.data.faireProductImage).toBe(
      "/api/admin/faire-image-proxy?url=https%3A%2F%2Fcdn.faire.com%2Fvariant1.webp",
    );
  });

  it("fallback : scanne le catalogue Faire par préfixe SKU quand les SKUs locaux ne matchent pas", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    // (1) Les 3 candidats (ref exacte + 2 SKUs longs) sont essayés → rien.
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    mockFaireSearchOk([]);
    // (2) Fallback : scan page 1 du catalogue.
    //     On simule un produit Faire avec un SKU custom (suffixe d'ID variante
    //     différent de ce que BJ générerait aujourd'hui), mais qui commence
    //     bien par "f137_".
    const remoteProduct = buildFaireProduct({
      id: "p_old_publish",
      variants: [
        {
          id: "po_old_or",
          sku: "f137_argent_UNIT_btjq32q5",
          name: "Argent",
          lifecycle_state: "PUBLISHED",
          available_quantity: 5,
          wholesale_price_cents: 750,
          retail_price_cents: 1500,
          options: [{ name: "Color", value: "Argent" }],
        },
      ],
    });
    // 2 produits sur la page : un qui ne match pas le préfixe, un qui match
    mockFaireSearchOk([
      {
        id: "p_other",
        name: "Autre",
        lifecycle_state: "PUBLISHED",
        variants: [
          {
            id: "po_other",
            sku: "g999_xx_UNIT_aaaa",
            options: [{ name: "Color", value: "X" }],
          },
        ],
      },
      remoteProduct,
    ]);

    const res = await previewFaireMatchBySku("p1", "F137");
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.faireProductId).toBe("p_old_publish");
    // 3 candidats SKU (ref exacte + 2 longs) + 1 appel scan = 4 au total
    expect(faireApiMock.faireFetch).toHaveBeenCalledTimes(4);
  });

  it("prend le produit PUBLISHED si plusieurs matchent et signale les autres", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    const deleted = buildFaireProduct({
      id: "p_old1",
      lifecycle_state: "DELETED",
    });
    const draft = buildFaireProduct({
      id: "p_draft",
      lifecycle_state: "DRAFT",
    });
    const live = buildFaireProduct({ id: "p_live", lifecycle_state: "PUBLISHED" });
    // SKU complet → 1 seul appel API, on simule plusieurs résultats
    mockFaireSearchOk([deleted, draft, live]);

    const res = await previewFaireMatchBySku("p1", "f137_dore_UNIT_xxxx");
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.faireProductId).toBe("p_live");
    expect(res.data.faireLifecycleState).toBe("PUBLISHED");
    expect(res.data.otherMatchesCount).toBe(2);
  });

  it("remonte HTTP non-OK comme erreur lisible (SKU complet → 1 seul appel)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce(buildBjProduct());
    faireApiMock.faireFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "boom",
    });
    // Input ressemble à un SKU complet (contient _UNIT_) → 1 seul appel,
    // l'erreur HTTP remonte directement.
    const res = await previewFaireMatchBySku("p1", "f137_dore_UNIT_xxxx");
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/HTTP 500/);
  });
});

// ─── linkFaireProductManually ─────────────────────────────────────

describe("linkFaireProductManually", () => {
  it("refuse les doublons de faireVariantId", async () => {
    const res = await linkFaireProductManually("p1", "p_abc123", [
      { productColorId: "pc-or", faireVariantId: "X" },
      { productColorId: "pc-arg", faireVariantId: "X" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/plusieurs fois/);
  });

  it("refuse les doublons de productColorId", async () => {
    const res = await linkFaireProductManually("p1", "p_abc123", [
      { productColorId: "pc-or", faireVariantId: "X" },
      { productColorId: "pc-or", faireVariantId: "Y" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/plusieurs variantes Faire/);
  });

  it("refuse un faireProductId vide", async () => {
    const res = await linkFaireProductManually("p1", "", [
      { productColorId: "pc-or", faireVariantId: "X" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/vide/);
  });

  it("refuse les liens vides", async () => {
    const res = await linkFaireProductManually("p1", "p_abc123", []);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Aucune couleur/);
  });

  it("refuse si une ProductColor n'appartient pas au produit", async () => {
    prismaMock.productColor.findMany.mockResolvedValueOnce([
      { id: "pc-or" }, // pc-arg manquant
    ]);
    const res = await linkFaireProductManually("p1", "p_abc123", [
      { productColorId: "pc-or", faireVariantId: "X" },
      { productColorId: "pc-arg", faireVariantId: "Y" },
    ]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/n'appartiennent pas/);
  });

  it("écrit faireProductId + faireVariantId + lance la sync best-effort", async () => {
    prismaMock.productColor.findMany.mockResolvedValueOnce([{ id: "pc-or" }]);
    faireUpdateMock.faireUpdateProduct.mockResolvedValueOnce({
      success: true,
      noop: false,
      diff: {},
    });

    const res = await linkFaireProductManually("p1", "p_abc123", [
      { productColorId: "pc-or", faireVariantId: "po_or" },
    ]);

    expect(res.success).toBe(true);
    expect(res.linked).toBe(1);
    expect(res.syncWarning).toBeUndefined();
    expect(prismaMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          faireProductId: "p_abc123",
          faireSyncRequired: false,
        }),
      }),
    );
    expect(prismaMock.productColor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "p1" },
        data: { faireVariantId: null },
      }),
    );
    expect(prismaMock.productColor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pc-or" },
        data: { faireVariantId: "po_or" },
      }),
    );
    expect(faireUpdateMock.faireUpdateProduct).toHaveBeenCalledWith("p1");
  });

  it("remonte un syncWarning si la sync post-liaison échoue", async () => {
    prismaMock.productColor.findMany.mockResolvedValueOnce([{ id: "pc-or" }]);
    faireUpdateMock.faireUpdateProduct.mockResolvedValueOnce({
      success: false,
      error: "Faire 502",
    });

    const res = await linkFaireProductManually("p1", "p_abc123", [
      { productColorId: "pc-or", faireVariantId: "po_or" },
    ]);

    expect(res.success).toBe(true);
    expect(res.syncWarning).toBe("Faire 502");
  });
});

// ─── removeFaireMatch ─────────────────────────────────────────────

describe("removeFaireMatch", () => {
  it("efface faireProductId + tous les faireVariantId", async () => {
    const res = await removeFaireMatch("p1");
    expect(res.success).toBe(true);
    expect(prismaMock.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          faireProductId: null,
          faireSyncRequired: false,
        }),
      }),
    );
    expect(prismaMock.productColor.updateMany).toHaveBeenCalledWith({
      where: { productId: "p1" },
      data: { faireVariantId: null },
    });
  });
});
