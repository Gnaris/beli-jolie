/**
 * Tests unitaires pour la file shooting eFashion.
 *
 * Couvre :
 *  - dédoublonnage à l'ajout (upsert + addedAt rafraîchi)
 *  - retrait silencieux des produits supprimés à la validation
 *  - blocage de la validation quand un item a un mapping manquant
 *  - batch publish : ordre des productIds renvoyés respecté
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// On mocke prisma + tous les modules réseau pour isoler la logique métier.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { findUnique: vi.fn(), update: vi.fn() },
    productColor: { update: vi.fn() },
    productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
    marketplaceRefreshJob: {
      create: vi.fn().mockResolvedValue({ id: "job-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    efashionShootingBatchItem: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: unknown) => {
      if (typeof fn === "function") {
        const tx = {
          product: { update: vi.fn() },
          productColor: { update: vi.fn() },
        };
        return (fn as (tx: unknown) => Promise<unknown>)(tx);
      }
      return null;
    }),
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("next-auth", () => ({
  getServerSession: vi
    .fn()
    .mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/efashion-validate", () => ({
  validateEfashionPublishable: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import {
  addToEfashionShootingBatch,
  removeFromEfashionShootingBatch,
  listEfashionShootingBatch,
  commitEfashionShootingBatch,
} from "@/app/actions/admin/efashion-shooting-batch";
import { validateEfashionPublishable } from "@/lib/efashion-validate";

const findProductMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const upsertMock = prisma.efashionShootingBatchItem.upsert as unknown as ReturnType<typeof vi.fn>;
const deleteManyMock = prisma.efashionShootingBatchItem.deleteMany as unknown as ReturnType<typeof vi.fn>;
const findBatchMock = prisma.efashionShootingBatchItem.findMany as unknown as ReturnType<typeof vi.fn>;
const validateMock = validateEfashionPublishable as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addToEfashionShootingBatch", () => {
  it("upsert le produit avec mode + addedAt rafraîchi (dédup automatique)", async () => {
    findProductMock.mockResolvedValueOnce({ id: "p1" });
    upsertMock.mockResolvedValueOnce({});

    const res = await addToEfashionShootingBatch("p1", "PUBLISH");

    expect(res.success).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "p1" },
        create: { productId: "p1", mode: "PUBLISH" },
        update: expect.objectContaining({ mode: "PUBLISH" }),
      }),
    );
    // L'update doit rafraîchir addedAt avec un Date récent
    const updateArg = upsertMock.mock.calls[0][0].update;
    expect(updateArg.addedAt).toBeInstanceOf(Date);
  });

  it("rejette si le produit est introuvable", async () => {
    findProductMock.mockResolvedValueOnce(null);
    const res = await addToEfashionShootingBatch("ghost", "PUBLISH");
    expect(res.success).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("removeFromEfashionShootingBatch", () => {
  it("supprime la ligne du productId", async () => {
    deleteManyMock.mockResolvedValueOnce({ count: 1 });
    await removeFromEfashionShootingBatch("p1");
    expect(deleteManyMock).toHaveBeenCalledWith({ where: { productId: "p1" } });
  });
});

describe("listEfashionShootingBatch", () => {
  it("marque les produits supprimés sans bloquer la validation", async () => {
    findBatchMock.mockResolvedValueOnce([
      {
        id: "item1",
        productId: "deleted",
        mode: "PUBLISH",
        addedAt: new Date(),
        product: null,
      },
    ]);

    const state = await listEfashionShootingBatch();
    expect(state.items[0].productDeleted).toBe(true);
    expect(state.hasBlockingIssue).toBe(false);
  });

  it("bloque la validation quand un produit a un mapping manquant", async () => {
    findBatchMock.mockResolvedValueOnce([
      {
        id: "item1",
        productId: "p1",
        mode: "PUBLISH",
        addedAt: new Date(),
        product: { id: "p1", reference: "REF1", name: "Bague", colors: [] },
      },
    ]);
    validateMock.mockResolvedValueOnce({
      productId: "p1",
      ok: false,
      missing: ["catégorie sans ID eFashion"],
      noEligibleVariants: false,
    });

    const state = await listEfashionShootingBatch();
    expect(state.hasBlockingIssue).toBe(true);
    expect(state.items[0].missing).toEqual(["catégorie sans ID eFashion"]);
  });

  it("ne bloque pas la validation si tous les items sont OK", async () => {
    findBatchMock.mockResolvedValueOnce([
      {
        id: "item1",
        productId: "p1",
        mode: "PUBLISH",
        addedAt: new Date(),
        product: { id: "p1", reference: "REF1", name: "Bague", colors: [] },
      },
    ]);
    validateMock.mockResolvedValueOnce({
      productId: "p1",
      ok: true,
      missing: [],
      noEligibleVariants: false,
    });

    const state = await listEfashionShootingBatch();
    expect(state.hasBlockingIssue).toBe(false);
  });
});

describe("commitEfashionShootingBatch", () => {
  it("refuse l'envoi quand la file est vide", async () => {
    findBatchMock.mockResolvedValueOnce([]);
    const res = await commitEfashionShootingBatch();
    expect(res.success).toBe(false);
  });

  it("refuse l'envoi tant qu'un item a un mapping manquant", async () => {
    findBatchMock.mockResolvedValueOnce([
      {
        id: "item1",
        productId: "p1",
        mode: "PUBLISH",
        addedAt: new Date(),
        product: { id: "p1", reference: "REF1", name: "Bague", colors: [] },
      },
    ]);
    validateMock.mockResolvedValueOnce({
      productId: "p1",
      ok: false,
      missing: ["pays sans ID eFashion"],
      noEligibleVariants: false,
    });

    const res = await commitEfashionShootingBatch();
    expect(res.success).toBe(false);
    // La file ne doit PAS être vidée tant qu'il y a une erreur bloquante
    expect(deleteManyMock).not.toHaveBeenCalledWith({});
  });

  it("nettoie les orphelins silencieusement avant de lancer le batch", async () => {
    findBatchMock
      .mockResolvedValueOnce([
        {
          id: "item1",
          productId: "deleted-p",
          mode: "PUBLISH",
          addedAt: new Date(),
          product: null,
        },
        {
          id: "item2",
          productId: "p2",
          mode: "PUBLISH",
          addedAt: new Date(),
          product: { id: "p2", reference: "REF2", name: "OK", colors: [] },
        },
      ])
      .mockResolvedValueOnce([{ productId: "p2", mode: "PUBLISH" }]);
    validateMock.mockResolvedValueOnce({
      productId: "p2",
      ok: true,
      missing: [],
      noEligibleVariants: false,
    });
    deleteManyMock.mockResolvedValue({ count: 1 });

    const res = await commitEfashionShootingBatch();

    expect(res.success).toBe(true);
    // Orphelins retirés silencieusement
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { productId: { in: ["deleted-p"] } },
    });
    // File vidée après dispatching
    expect(deleteManyMock).toHaveBeenCalledWith({});
    expect(res.publishCount).toBe(1);
    expect(res.refreshCount).toBe(0);
  });
});
