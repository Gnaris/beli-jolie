import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Prisma mocks ────────────────────────────────────────────────────────
const mockCardFindFirst = vi.fn();
const mockProductFindFirst = vi.fn();
const mockProductFindMany = vi.fn();
const mockProductColorFindFirst = vi.fn();
const mockPfsItemFindMany = vi.fn();
const mockPurchaseFindMany = vi.fn();
const mockPurchaseFindFirst = vi.fn();
const mockPurchaseCreate = vi.fn();
const mockPurchaseUpdate = vi.fn();
const mockPurchaseDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminClientCard: { findFirst: (...a: unknown[]) => mockCardFindFirst(...a) },
    product: {
      findFirst: (...a: unknown[]) => mockProductFindFirst(...a),
      findMany: (...a: unknown[]) => mockProductFindMany(...a),
    },
    productColor: {
      findFirst: (...a: unknown[]) => mockProductColorFindFirst(...a),
    },
    pfsOrderItem: { findMany: (...a: unknown[]) => mockPfsItemFindMany(...a) },
    adminClientCardProductPurchase: {
      findMany: (...a: unknown[]) => mockPurchaseFindMany(...a),
      findFirst: (...a: unknown[]) => mockPurchaseFindFirst(...a),
      create: (...a: unknown[]) => mockPurchaseCreate(...a),
      update: (...a: unknown[]) => mockPurchaseUpdate(...a),
      delete: (...a: unknown[]) => mockPurchaseDelete(...a),
    },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi.fn().mockResolvedValue({
    id: "tenant-1",
    slug: "beli-jolie",
    name: "Beli & Jolie",
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import {
  listOrderedProductsForClientCard,
  addPurchaseToClientCard,
  updatePurchase,
  deletePurchase,
  lookupProductByReference,
  searchProductsForClientCard,
} from "@/app/actions/admin/admin-client-card-products";

const CARD_ID = "card-42";
const TENANT_ID = "tenant-1";

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────
// listOrderedProductsForClientCard
// ─────────────────────────────────────────────

describe("listOrderedProductsForClientCard", () => {
  it("retourne vide si la fiche n'existe pas", async () => {
    mockCardFindFirst.mockResolvedValue(null);
    const res = await listOrderedProductsForClientCard({
      adminClientCardId: CARD_ID,
    });
    expect(res.rows).toEqual([]);
    expect(res.totalCount).toBe(0);
    expect(mockPfsItemFindMany).not.toHaveBeenCalled();
  });

  it("agrège la qté PFS auto par (produit × couleur), multipliée par packQuantity pour un PACK", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockPfsItemFindMany.mockResolvedValue([
      {
        productId: "p-1",
        productColorId: "pc-red",
        qtyOrdered: 2,
        pfsOrder: { createdAtPfs: new Date("2026-07-15T00:00:00Z") },
        productColor: { saleType: "UNIT", packQuantity: null },
      },
      {
        // 2 paquets de 5 = 10 pièces
        productId: "p-1",
        productColorId: "pc-red",
        qtyOrdered: 2,
        pfsOrder: { createdAtPfs: new Date("2026-07-10T00:00:00Z") },
        productColor: { saleType: "PACK", packQuantity: 5 },
      },
    ]);
    mockPurchaseFindMany.mockResolvedValue([]);
    mockProductFindMany.mockResolvedValue([
      {
        id: "p-1",
        name: "Bracelet",
        reference: "REF1",
        category: { name: "Bracelets" },
        colors: [
          {
            id: "pc-red",
            isPrimary: true,
            color: { id: "c-red", name: "Rouge", hex: "#f00", patternImage: null },
            images: [{ path: "/uploads/p-1.jpg" }],
          },
        ],
      },
    ]);

    const res = await listOrderedProductsForClientCard({
      adminClientCardId: CARD_ID,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].colors[0].pfsQuantity).toBe(12); // 2 + 10
    expect(res.rows[0].colors[0].totalQuantity).toBe(12);
    expect(res.rows[0].sources).toContain("PFS");
  });

  it("combine PFS auto + purchases (autre source additive, PFS = max)", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockPfsItemFindMany.mockResolvedValue([
      {
        productId: "p-1",
        productColorId: "pc-red",
        qtyOrdered: 4,
        pfsOrder: { createdAtPfs: new Date("2026-07-15T00:00:00Z") },
        productColor: { saleType: "UNIT", packQuantity: null },
      },
    ]);
    mockPurchaseFindMany.mockResolvedValue([
      {
        id: "buy-1",
        productId: "p-1",
        productColorId: "pc-red",
        source: "PFS",
        quantity: 2, // < auto 4 → auto gagne
        createdAt: new Date("2026-07-16T00:00:00Z"),
        updatedAt: new Date("2026-07-16T00:00:00Z"),
      },
      {
        id: "buy-2",
        productId: "p-1",
        productColorId: "pc-red",
        source: "FAIRE",
        quantity: 3,
        createdAt: new Date("2026-07-18T00:00:00Z"),
        updatedAt: new Date("2026-07-18T00:00:00Z"),
      },
    ]);
    mockProductFindMany.mockResolvedValue([
      {
        id: "p-1",
        name: "Bracelet",
        reference: "REF1",
        category: { name: "Bracelets" },
        colors: [
          {
            id: "pc-red",
            isPrimary: true,
            color: { id: "c-red", name: "Rouge", hex: "#f00", patternImage: null },
            images: [{ path: "/uploads/p-1.jpg" }],
          },
        ],
      },
    ]);

    const res = await listOrderedProductsForClientCard({
      adminClientCardId: CARD_ID,
    });
    const color = res.rows[0].colors[0];
    // max(4, 2) + 3 = 7
    expect(color.totalQuantity).toBe(7);
    expect(res.rows[0].sources.sort()).toEqual(["FAIRE", "PFS"]);
  });

  it("écarte les produits sans quantité (jamais commandés)", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockPfsItemFindMany.mockResolvedValue([]);
    mockPurchaseFindMany.mockResolvedValue([]);
    mockProductFindMany.mockResolvedValue([]);
    const res = await listOrderedProductsForClientCard({
      adminClientCardId: CARD_ID,
    });
    expect(res.rows).toEqual([]);
  });

  it("pagine et tri par quantité décroissante", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockPfsItemFindMany.mockResolvedValue([
      {
        productId: "p-1",
        productColorId: "pc-1",
        qtyOrdered: 1,
        pfsOrder: { createdAtPfs: new Date("2026-07-01T00:00:00Z") },
        productColor: { saleType: "UNIT", packQuantity: null },
      },
      {
        productId: "p-2",
        productColorId: "pc-2",
        qtyOrdered: 5,
        pfsOrder: { createdAtPfs: new Date("2026-07-01T00:00:00Z") },
        productColor: { saleType: "UNIT", packQuantity: null },
      },
    ]);
    mockPurchaseFindMany.mockResolvedValue([]);
    mockProductFindMany.mockResolvedValue([
      {
        id: "p-1",
        name: "A",
        reference: "R1",
        category: { name: "Cat" },
        colors: [
          {
            id: "pc-1",
            isPrimary: true,
            color: { id: "c1", name: "X", hex: null, patternImage: null },
            images: [],
          },
        ],
      },
      {
        id: "p-2",
        name: "B",
        reference: "R2",
        category: { name: "Cat" },
        colors: [
          {
            id: "pc-2",
            isPrimary: true,
            color: { id: "c2", name: "Y", hex: null, patternImage: null },
            images: [],
          },
        ],
      },
    ]);

    const res = await listOrderedProductsForClientCard({
      adminClientCardId: CARD_ID,
      sortBy: "quantity_desc",
      perPage: 1,
      page: 1,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].productId).toBe("p-2");
    expect(res.totalCount).toBe(2);
    expect(res.totalPages).toBe(2);
  });
});

// ─────────────────────────────────────────────
// addPurchaseToClientCard
// ─────────────────────────────────────────────

describe("addPurchaseToClientCard", () => {
  const baseInput = {
    adminClientCardId: CARD_ID,
    reference: "REF1",
    colorId: "pc-red",
    source: "MICROSTORE" as const,
    quantity: 2,
  };

  it("refuse une quantité invalide", async () => {
    await expect(
      addPurchaseToClientCard({ ...baseInput, quantity: 0 }),
    ).rejects.toThrow(/quantité/i);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  it("refuse si la fiche est introuvable", async () => {
    mockCardFindFirst.mockResolvedValue(null);
    await expect(addPurchaseToClientCard(baseInput)).rejects.toThrow(/fiche/i);
  });

  it("refuse si le produit est introuvable", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockProductFindFirst.mockResolvedValue(null);
    await expect(addPurchaseToClientCard(baseInput)).rejects.toThrow(/référence/i);
  });

  it("refuse si la couleur n'appartient pas au produit", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockProductFindFirst.mockResolvedValue({ id: "p-1" });
    mockProductColorFindFirst.mockResolvedValue(null);
    await expect(addPurchaseToClientCard(baseInput)).rejects.toThrow(/couleur/i);
  });

  it("crée une nouvelle ligne quand rien n'existe", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockProductFindFirst.mockResolvedValue({ id: "p-1" });
    mockProductColorFindFirst.mockResolvedValue({ id: "pc-red" });
    mockPurchaseFindFirst.mockResolvedValue(null);
    mockPurchaseCreate.mockResolvedValue({ id: "buy-1" });

    const res = await addPurchaseToClientCard(baseInput);
    expect(res.success).toBe(true);
    expect(mockPurchaseCreate).toHaveBeenCalledOnce();
    const arg = mockPurchaseCreate.mock.calls[0][0];
    expect(arg.data.tenantId).toBe(TENANT_ID);
    expect(arg.data.source).toBe("MICROSTORE");
    expect(arg.data.quantity).toBe(2);
    expect(arg.data.addedById).toBe("admin-1");
  });

  it("additionne la quantité quand la même provenance existe déjà", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockProductFindFirst.mockResolvedValue({ id: "p-1" });
    mockProductColorFindFirst.mockResolvedValue({ id: "pc-red" });
    mockPurchaseFindFirst.mockResolvedValue({ id: "buy-1", quantity: 3 });

    await addPurchaseToClientCard({ ...baseInput, quantity: 2 });
    expect(mockPurchaseUpdate).toHaveBeenCalledOnce();
    expect(mockPurchaseUpdate.mock.calls[0][0].data.quantity).toBe(5);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  it("refuse une qté PFS strictement inférieure au calcul PFS auto", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockProductFindFirst.mockResolvedValue({ id: "p-1" });
    mockProductColorFindFirst.mockResolvedValue({ id: "pc-red" });
    mockPurchaseFindFirst.mockResolvedValue(null);
    // PFS auto = 5 pcs
    mockPfsItemFindMany.mockResolvedValue([
      { qtyOrdered: 5, productColor: { saleType: "UNIT", packQuantity: null } },
    ]);

    await expect(
      addPurchaseToClientCard({ ...baseInput, source: "PFS", quantity: 3 }),
    ).rejects.toThrow(/PFS/i);
    expect(mockPurchaseCreate).not.toHaveBeenCalled();
  });

  it("accepte une qté PFS égale au calcul auto", async () => {
    mockCardFindFirst.mockResolvedValue({ id: CARD_ID });
    mockProductFindFirst.mockResolvedValue({ id: "p-1" });
    mockProductColorFindFirst.mockResolvedValue({ id: "pc-red" });
    mockPurchaseFindFirst.mockResolvedValue(null);
    mockPfsItemFindMany.mockResolvedValue([
      { qtyOrdered: 3, productColor: { saleType: "UNIT", packQuantity: null } },
    ]);
    mockPurchaseCreate.mockResolvedValue({ id: "buy-1" });

    const res = await addPurchaseToClientCard({
      ...baseInput,
      source: "PFS",
      quantity: 3,
    });
    expect(res.success).toBe(true);
    expect(mockPurchaseCreate).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// updatePurchase
// ─────────────────────────────────────────────

describe("updatePurchase", () => {
  it("met à jour source + quantité quand pas de conflit", async () => {
    mockPurchaseFindFirst
      .mockResolvedValueOnce({
        id: "buy-1",
        adminClientCardId: CARD_ID,
        productId: "p-1",
        productColorId: "pc-red",
        source: "MICROSTORE",
      })
      .mockResolvedValueOnce(null); // pas de conflit

    await updatePurchase({
      purchaseId: "buy-1",
      source: "FAIRE",
      quantity: 4,
    });
    expect(mockPurchaseUpdate).toHaveBeenCalledOnce();
    expect(mockPurchaseUpdate.mock.calls[0][0].data).toEqual({
      source: "FAIRE",
      quantity: 4,
    });
  });

  it("fusionne les 2 lignes si la nouvelle source entre en conflit", async () => {
    mockPurchaseFindFirst
      .mockResolvedValueOnce({
        id: "buy-1",
        adminClientCardId: CARD_ID,
        productId: "p-1",
        productColorId: "pc-red",
        source: "MICROSTORE",
      })
      .mockResolvedValueOnce({ id: "buy-2", quantity: 3 });
    mockTransaction.mockResolvedValue([]);

    await updatePurchase({
      purchaseId: "buy-1",
      source: "FAIRE",
      quantity: 4,
    });
    expect(mockTransaction).toHaveBeenCalledOnce();
    // 3 + 4 = 7 pour la ligne conservée
    const ops = mockTransaction.mock.calls[0][0];
    expect(Array.isArray(ops)).toBe(true);
  });

  it("refuse une bascule vers PFS < auto", async () => {
    mockPurchaseFindFirst
      .mockResolvedValueOnce({
        id: "buy-1",
        adminClientCardId: CARD_ID,
        productId: "p-1",
        productColorId: "pc-red",
        source: "MICROSTORE",
      })
      .mockResolvedValueOnce(null); // pas de conflit PFS existant
    mockPfsItemFindMany.mockResolvedValue([
      { qtyOrdered: 10, productColor: { saleType: "UNIT", packQuantity: null } },
    ]);

    await expect(
      updatePurchase({ purchaseId: "buy-1", source: "PFS", quantity: 5 }),
    ).rejects.toThrow(/PFS/i);
  });

  it("refuse une entrée introuvable", async () => {
    mockPurchaseFindFirst.mockResolvedValue(null);
    await expect(
      updatePurchase({ purchaseId: "nope", source: "FAIRE", quantity: 1 }),
    ).rejects.toThrow(/introuvable/i);
  });
});

// ─────────────────────────────────────────────
// deletePurchase
// ─────────────────────────────────────────────

describe("deletePurchase", () => {
  it("supprime quand l'entrée existe", async () => {
    mockPurchaseFindFirst.mockResolvedValue({ id: "buy-1" });
    mockPurchaseDelete.mockResolvedValue({});
    const res = await deletePurchase("buy-1");
    expect(res.success).toBe(true);
    expect(mockPurchaseDelete).toHaveBeenCalledWith({ where: { id: "buy-1" } });
  });

  it("refuse quand l'entrée est absente du tenant", async () => {
    mockPurchaseFindFirst.mockResolvedValue(null);
    await expect(deletePurchase("buy-x")).rejects.toThrow(/introuvable/i);
  });
});

// ─────────────────────────────────────────────
// lookupProductByReference
// ─────────────────────────────────────────────

describe("lookupProductByReference", () => {
  it("retourne null pour une référence vide", async () => {
    const res = await lookupProductByReference("   ");
    expect(res).toBeNull();
  });

  it("retourne null si aucun produit trouvé", async () => {
    mockProductFindFirst.mockResolvedValue(null);
    const res = await lookupProductByReference("XYZ");
    expect(res).toBeNull();
  });

  it("retourne le produit + ses couleurs actives", async () => {
    mockProductFindFirst.mockResolvedValue({
      id: "p-1",
      name: "Bracelet",
      reference: "REF1",
      category: { name: "Bracelets" },
      colors: [
        {
          id: "pc-red",
          color: { name: "Rouge", hex: "#f00", patternImage: null },
          images: [{ path: "/uploads/p-1.jpg" }],
        },
      ],
    });
    const res = await lookupProductByReference("REF1");
    expect(res).not.toBeNull();
    expect(res!.colors).toHaveLength(1);
    expect(res!.colors[0].name).toBe("Rouge");
    expect(res!.colors[0].image).toBe("/uploads/p-1.jpg");
  });
});

// ─────────────────────────────────────────────
// searchProductsForClientCard
// ─────────────────────────────────────────────

describe("searchProductsForClientCard", () => {
  it("retourne [] pour une requête trop courte", async () => {
    const res = await searchProductsForClientCard("b");
    expect(res).toEqual([]);
    expect(mockProductFindMany).not.toHaveBeenCalled();
  });

  it("cherche par nom OU référence et scope par tenant", async () => {
    mockProductFindMany.mockResolvedValue([
      {
        id: "p-1",
        name: "Bracelet doré",
        reference: "REF1",
        category: { name: "Bracelets" },
        colors: [{ images: [{ path: "/uploads/p-1.jpg" }] }],
      },
    ]);
    const res = await searchProductsForClientCard("bracelet");
    expect(mockProductFindMany).toHaveBeenCalledOnce();
    const arg = mockProductFindMany.mock.calls[0][0];
    expect(arg.where.tenantId).toBe(TENANT_ID);
    expect(arg.where.status).toEqual({ not: "ARCHIVED" });
    expect(arg.take).toBe(10);
    expect(res[0]).toEqual({
      id: "p-1",
      name: "Bracelet doré",
      reference: "REF1",
      category: "Bracelets",
      image: "/uploads/p-1.jpg",
    });
  });
});

// ─────────────────────────────────────────────
// Garde-fous admin
// ─────────────────────────────────────────────

describe("garde-fous admin", () => {
  it("refuse listOrderedProductsForClientCard sans admin", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(
      listOrderedProductsForClientCard({ adminClientCardId: CARD_ID }),
    ).rejects.toThrow(/non autorisé/i);
  });

  it("refuse addPurchaseToClientCard depuis un CLIENT", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "c1", role: "CLIENT" },
    });
    await expect(
      addPurchaseToClientCard({
        adminClientCardId: CARD_ID,
        reference: "REF1",
        colorId: "pc-red",
        source: "MICROSTORE",
        quantity: 1,
      }),
    ).rejects.toThrow(/non autorisé/i);
  });

  it("refuse deletePurchase sans admin", async () => {
    const nextAuth = await import("next-auth");
    (nextAuth.getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(deletePurchase("buy-x")).rejects.toThrow(/non autorisé/i);
  });
});
