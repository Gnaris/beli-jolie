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
    product: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
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
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") {
        const tx = {
          product: { update: vi.fn() },
          productColor: { update: vi.fn() },
        };
        return (arg as (tx: unknown) => Promise<unknown>)(tx);
      }
      // Forme tableau : Prisma exécute toutes les promesses passées et retourne
      // un tableau de résultats. Pour la simulation, on les exécute en parallèle.
      if (Array.isArray(arg)) {
        return Promise.all(arg);
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
vi.mock("@/lib/marketplace-job-intent", () => ({
  // Par défaut : traite tous les inputs "publish" comme des CREATE (produit sans ID).
  // Les tests peuvent override via `.mockResolvedValueOnce(...)` si besoin.
  resolveJobIntentsBulk: vi.fn(async (inputs: Array<{ mode: string }>) =>
    inputs.map((i) => (i.mode === "publish" ? "CREATE" : "REFRESH")),
  ),
}));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi.fn().mockResolvedValue({ id: "t1", slug: "beliandjolie" }),
}));
vi.mock("@/lib/tenant-als", () => ({
  tenantALS: { run: (_id: string, fn: () => Promise<unknown>) => fn() },
}));
// Le runner est importé dynamiquement dans commitEfashionShootingBatch
// (via `await import(...)` fire-and-forget). On l'ignore ici — le test valide
// seulement l'état avant le dispatch.
vi.mock("@/lib/efashion-shooting-batch-runner", () => ({
  runEfashionShootingBatch: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/prisma";
import {
  addToEfashionShootingBatch,
  bulkAddToEfashionShootingBatch,
  removeFromEfashionShootingBatch,
  clearEfashionShootingBatch,
  listEfashionShootingBatch,
  commitEfashionShootingBatch,
} from "@/app/actions/admin/efashion-shooting-batch";
import { validateEfashionPublishable } from "@/lib/efashion-validate";

const findProductMock = prisma.product.findUnique as unknown as ReturnType<typeof vi.fn>;
const findProductManyMock = prisma.product.findMany as unknown as ReturnType<typeof vi.fn>;
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

describe("bulkAddToEfashionShootingBatch", () => {
  it("renvoie addedCount=0 et missingIds=[] quand la liste est vide", async () => {
    const res = await bulkAddToEfashionShootingBatch([], "PUBLISH");
    expect(res).toEqual({ success: true, addedCount: 0, missingIds: [] });
    expect(findProductManyMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("upsert un item par produit existant et ignore les ids inconnus", async () => {
    findProductManyMock.mockResolvedValueOnce([{ id: "p1" }, { id: "p3" }]);

    const res = await bulkAddToEfashionShootingBatch(["p1", "p2", "p3"], "PUBLISH");

    expect(res.success).toBe(true);
    expect(res.addedCount).toBe(2);
    expect(res.missingIds).toEqual(["p2"]);
    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "p1" },
        create: { productId: "p1", mode: "PUBLISH" },
        update: expect.objectContaining({ mode: "PUBLISH" }),
      }),
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "p3" },
        create: { productId: "p3", mode: "PUBLISH" },
      }),
    );
  });

  it("ne déclenche aucune écriture si tous les ids sont inconnus", async () => {
    findProductManyMock.mockResolvedValueOnce([]);

    const res = await bulkAddToEfashionShootingBatch(["ghost1", "ghost2"], "PUBLISH");

    expect(res.addedCount).toBe(0);
    expect(res.missingIds).toEqual(["ghost1", "ghost2"]);
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

describe("clearEfashionShootingBatch", () => {
  it("vide entièrement la file et remonte le compte retiré", async () => {
    deleteManyMock.mockResolvedValueOnce({ count: 4 });
    const res = await clearEfashionShootingBatch();
    expect(res).toEqual({ success: true, removedCount: 4 });
    // Sans clause where => vide tout
    expect(deleteManyMock).toHaveBeenCalledWith({});
  });

  it("renvoie removedCount=0 quand la file est déjà vide", async () => {
    deleteManyMock.mockResolvedValueOnce({ count: 0 });
    const res = await clearEfashionShootingBatch();
    expect(res).toEqual({ success: true, removedCount: 0 });
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
      },
    ]);
    // Le produit "deleted" n'existe pas → findMany renvoie tableau vide
    findProductManyMock.mockResolvedValueOnce([]);

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
      },
    ]);
    findProductManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "REF1", name: "Bague", colors: [] },
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
      },
    ]);
    findProductManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "REF1", name: "Bague", colors: [] },
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
      },
    ]);
    findProductManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "REF1", name: "Bague", colors: [] },
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

  it("pose intent=CREATE sur les jobs PUBLISH (pour affichage dans onglet Création)", async () => {
    findBatchMock
      .mockResolvedValueOnce([
        { id: "item1", productId: "p1", mode: "PUBLISH", addedAt: new Date() },
        { id: "item2", productId: "p2", mode: "REFRESH", addedAt: new Date() },
      ])
      .mockResolvedValueOnce([
        { productId: "p1", mode: "PUBLISH" },
        { productId: "p2", mode: "REFRESH" },
      ]);
    findProductManyMock.mockResolvedValueOnce([
      { id: "p1", reference: "R1", name: "P1", colors: [] },
      { id: "p2", reference: "R2", name: "P2", colors: [] },
    ]);
    validateMock.mockResolvedValue({
      productId: "p1",
      ok: true,
      missing: [],
      noEligibleVariants: false,
    });
    deleteManyMock.mockResolvedValue({ count: 0 });

    const createMock = prisma.marketplaceRefreshJob.create as unknown as ReturnType<
      typeof vi.fn
    >;
    createMock.mockClear();
    createMock.mockResolvedValue({ id: "job-x" });

    await commitEfashionShootingBatch();

    // Vérifie que chaque job est créé avec un intent explicite (bug 05/09/2026 :
    // sans ça, tous les jobs eFashion atterrissaient dans « Modification »).
    const jobCreations = createMock.mock.calls.map((c) => c[0].data);
    expect(jobCreations).toHaveLength(2);
    const publishJob = jobCreations.find((d) => d.mode === "PUBLISH");
    const refreshJob = jobCreations.find((d) => d.mode === "REFRESH");
    expect(publishJob?.intent).toBe("CREATE");
    expect(refreshJob?.intent).toBe("REFRESH");
  });

  it("nettoie les orphelins silencieusement avant de lancer le batch", async () => {
    findBatchMock
      .mockResolvedValueOnce([
        {
          id: "item1",
          productId: "deleted-p",
          mode: "PUBLISH",
          addedAt: new Date(),
        },
        {
          id: "item2",
          productId: "p2",
          mode: "PUBLISH",
          addedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ productId: "p2", mode: "PUBLISH" }]);
    // Un seul produit trouvé sur les 2 items → "deleted-p" est orphelin
    findProductManyMock.mockResolvedValueOnce([
      { id: "p2", reference: "REF2", name: "OK", colors: [] },
    ]);
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
    if (res.success) {
      expect(res.publishCount).toBe(1);
      expect(res.refreshCount).toBe(0);
    }
  });
});
