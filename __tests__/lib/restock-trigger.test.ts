/**
 * Tests unitaires de `enqueueRestockForProductColor` et des helpers purs
 * (`mergeEntries`, `parseEntries`).
 *
 * Objectif critique : vérifier que la règle anti-spam marche bien —
 *   1. 10 produits qui reviennent en stock pour un même client → UN seul
 *      job dont `entries` empile les 10 (pas 10 jobs ni 10 mails).
 *   2. Le compteur initial (`scheduledSendAt`) NE REDÉMARRE PAS quand on
 *      ajoute un produit à un job PENDING existant.
 *   3. Un produit déjà dans la file est merge-é (flags OR-és), pas doublé.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  productColor: { findUnique: vi.fn(), findMany: vi.fn() },
  siteConfig: { findFirst: vi.fn() },
  favorite: { findMany: vi.fn() },
  orderItem: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  restockNotificationJob: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  dropRestockEntryForProductColor,
  enqueueRestockForProductColor,
  mergeEntries,
  parseEntries,
  type RestockEntry,
} from "@/lib/restock-trigger";

describe("mergeEntries (helper pur)", () => {
  it("ajoute une entrée si productColorId pas déjà présent", () => {
    const existing: RestockEntry[] = [
      {
        productId: "p1",
        productColorId: "pc1",
        isFavorite: true,
        hasOrdered: false,
        addedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming: RestockEntry = {
      productId: "p2",
      productColorId: "pc2",
      isFavorite: false,
      hasOrdered: true,
      addedAt: "2026-01-02T00:00:00.000Z",
    };
    const merged = mergeEntries(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged[1].productColorId).toBe("pc2");
  });

  it("merge les flags OR-és si productColorId déjà présent", () => {
    const existing: RestockEntry[] = [
      {
        productId: "p1",
        productColorId: "pc1",
        isFavorite: true,
        hasOrdered: false,
        addedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming: RestockEntry = {
      productId: "p1",
      productColorId: "pc1",
      isFavorite: false,
      hasOrdered: true,
      addedAt: "2026-01-02T00:00:00.000Z",
    };
    const merged = mergeEntries(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].isFavorite).toBe(true);
    expect(merged[0].hasOrdered).toBe(true);
  });

  it("ne déclasse jamais un flag true → false", () => {
    const existing: RestockEntry[] = [
      {
        productId: "p1",
        productColorId: "pc1",
        isFavorite: true,
        hasOrdered: true,
        addedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const incoming: RestockEntry = {
      productId: "p1",
      productColorId: "pc1",
      isFavorite: false,
      hasOrdered: false,
      addedAt: "2026-01-02T00:00:00.000Z",
    };
    const merged = mergeEntries(existing, incoming);
    expect(merged[0].isFavorite).toBe(true);
    expect(merged[0].hasOrdered).toBe(true);
  });
});

describe("parseEntries (helper pur)", () => {
  it("retourne [] si raw n'est pas un array", () => {
    expect(parseEntries(null)).toEqual([]);
    expect(parseEntries(undefined)).toEqual([]);
    expect(parseEntries("foo")).toEqual([]);
    expect(parseEntries({ productColorId: "x" })).toEqual([]);
  });

  it("filtre les entrées malformées", () => {
    const raw = [
      { productId: "p1", productColorId: "pc1", addedAt: "2026-01-01" },
      { productColorId: "pc2", addedAt: "2026-01-02" }, // pas de productId
      { productId: "p3", productColorId: "pc3" }, // pas de addedAt
      null,
      "nope",
    ];
    expect(parseEntries(raw)).toHaveLength(1);
    expect(parseEntries(raw)[0].productId).toBe("p1");
  });
});

describe("dropRestockEntryForProductColor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retire l'entry du job PENDING, laisse les autres entries intactes", async () => {
    mockPrisma.restockNotificationJob.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        entries: [
          {
            productId: "p1",
            productColorId: "pc1",
            isFavorite: true,
            hasOrdered: false,
            addedAt: "2026-01-01",
          },
          {
            productId: "p2",
            productColorId: "pc2",
            isFavorite: false,
            hasOrdered: true,
            addedAt: "2026-01-01",
          },
        ],
      },
    ]);
    mockPrisma.restockNotificationJob.update.mockResolvedValueOnce({});

    await dropRestockEntryForProductColor("pc1", "t1");

    expect(mockPrisma.restockNotificationJob.update).toHaveBeenCalledTimes(1);
    const args = mockPrisma.restockNotificationJob.update.mock.calls[0][0];
    expect(args.where.id).toBe("job-1");
    expect(args.data.status).toBeUndefined();
    const entries = args.data.entries as RestockEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].productColorId).toBe("pc2");
  });

  it("passe le job en CANCELLED si c'était sa dernière entry", async () => {
    mockPrisma.restockNotificationJob.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        entries: [
          {
            productId: "p1",
            productColorId: "pc1",
            isFavorite: true,
            hasOrdered: false,
            addedAt: "2026-01-01",
          },
        ],
      },
    ]);
    mockPrisma.restockNotificationJob.update.mockResolvedValueOnce({});

    await dropRestockEntryForProductColor("pc1", "t1");

    expect(mockPrisma.restockNotificationJob.update).toHaveBeenCalledTimes(1);
    const args = mockPrisma.restockNotificationJob.update.mock.calls[0][0];
    expect(args.data.status).toBe("CANCELLED");
    expect(args.data.scheduledSendAt).toBeNull();
    expect(args.data.cancelReason).toBe("ALL_OUT_OF_STOCK_AGAIN");
  });

  it("ignore les jobs qui ne contiennent pas la variante", async () => {
    mockPrisma.restockNotificationJob.findMany.mockResolvedValueOnce([
      {
        id: "job-other",
        entries: [
          {
            productId: "p99",
            productColorId: "pc99",
            isFavorite: true,
            hasOrdered: false,
            addedAt: "2026-01-01",
          },
        ],
      },
    ]);

    await dropRestockEntryForProductColor("pc1", "t1");

    expect(mockPrisma.restockNotificationJob.update).not.toHaveBeenCalled();
  });
});

describe("enqueueRestockForProductColor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default : au moins une variante pour le produit — nécessaire pour que
    // `orderItem.findMany({ where: { productColorId: { in: [...] } } })` tourne.
    mockPrisma.productColor.findMany.mockResolvedValue([{ id: "pc1" }]);
  });

  it("bail silencieusement si la variante est PACK (décision cliente : UNIT seulement)", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc-pack",
      stock: 5,
      saleType: "PACK",
      product: { id: "p1", status: "ONLINE", tenantId: "t1" },
    });
    await enqueueRestockForProductColor("pc-pack");
    expect(mockPrisma.favorite.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.restockNotificationJob.create).not.toHaveBeenCalled();
  });

  it("bail silencieusement si le produit est OFFLINE", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc1",
      stock: 5,
      saleType: "UNIT",
      product: { id: "p1", status: "OFFLINE", tenantId: "t1" },
    });
    await enqueueRestockForProductColor("pc1");
    expect(mockPrisma.restockNotificationJob.create).not.toHaveBeenCalled();
    expect(mockPrisma.favorite.findMany).not.toHaveBeenCalled();
  });

  it("bail silencieusement si stock <= 0 (appelé à tort)", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc1",
      stock: 0,
      saleType: "UNIT",
      product: { id: "p1", status: "ONLINE", tenantId: "t1" },
    });
    await enqueueRestockForProductColor("pc1");
    expect(mockPrisma.restockNotificationJob.create).not.toHaveBeenCalled();
  });

  it("bail silencieusement si l'automation est désactivée", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc1",
      stock: 5,
      saleType: "UNIT",
      product: { id: "p1", status: "ONLINE", tenantId: "t1" },
    });
    mockPrisma.siteConfig.findFirst.mockResolvedValueOnce({ value: "false" });
    await enqueueRestockForProductColor("pc1");
    expect(mockPrisma.favorite.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.restockNotificationJob.create).not.toHaveBeenCalled();
  });

  it("crée un job PENDING avec entries=[entrée] quand aucun job n'existe pour le client", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc1",
      stock: 5,
      saleType: "UNIT",
      product: { id: "p1", status: "ONLINE", tenantId: "t1" },
    });
    mockPrisma.siteConfig.findFirst
      .mockResolvedValueOnce({ value: "true" }) // automation enabled
      .mockResolvedValueOnce(null); // delay (default 24h)
    mockPrisma.favorite.findMany.mockResolvedValueOnce([
      { userId: "u1" },
    ]);
    mockPrisma.orderItem.findMany.mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValueOnce([{ id: "u1" }]);
    mockPrisma.restockNotificationJob.findFirst.mockResolvedValueOnce(null);

    await enqueueRestockForProductColor("pc1", "t1");

    expect(mockPrisma.restockNotificationJob.create).toHaveBeenCalledTimes(1);
    const createArgs = mockPrisma.restockNotificationJob.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe("u1");
    expect(createArgs.data.tenantId).toBe("t1");
    expect(createArgs.data.status).toBe("PENDING");
    const entries = createArgs.data.entries as RestockEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].productColorId).toBe("pc1");
    expect(entries[0].isFavorite).toBe(true);
    expect(entries[0].hasOrdered).toBe(false);
    expect(createArgs.data.scheduledSendAt).toBeInstanceOf(Date);
  });

  it("empile dans entries SANS redémarrer le compteur si un job PENDING existe", async () => {
    const originalScheduled = new Date("2026-01-01T10:00:00.000Z");
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc2",
      stock: 3,
      saleType: "UNIT",
      product: { id: "p2", status: "ONLINE", tenantId: "t1" },
    });
    mockPrisma.siteConfig.findFirst
      .mockResolvedValueOnce({ value: "true" })
      .mockResolvedValueOnce(null);
    mockPrisma.favorite.findMany.mockResolvedValueOnce([{ userId: "u1" }]);
    mockPrisma.orderItem.findMany.mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValueOnce([{ id: "u1" }]);
    mockPrisma.restockNotificationJob.findFirst.mockResolvedValueOnce({
      id: "job-1",
      status: "PENDING",
      entries: [
        {
          productId: "p1",
          productColorId: "pc1",
          isFavorite: true,
          hasOrdered: false,
          addedAt: "2025-12-31T00:00:00.000Z",
        },
      ],
      scheduledSendAt: originalScheduled,
    });

    await enqueueRestockForProductColor("pc2", "t1");

    expect(mockPrisma.restockNotificationJob.create).not.toHaveBeenCalled();
    expect(mockPrisma.restockNotificationJob.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.restockNotificationJob.update.mock.calls[0][0];
    expect(updateArgs.where.id).toBe("job-1");
    // scheduledSendAt NE DOIT PAS être dans le payload — on ne reset pas le timer.
    expect(updateArgs.data.scheduledSendAt).toBeUndefined();
    const entries = updateArgs.data.entries as RestockEntry[];
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.productColorId).sort()).toEqual(["pc1", "pc2"]);
  });

  it("remet en PENDING + reset timer si le job était COMPLETED (nouveau cycle)", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc3",
      stock: 2,
      saleType: "UNIT",
      product: { id: "p3", status: "ONLINE", tenantId: "t1" },
    });
    mockPrisma.siteConfig.findFirst
      .mockResolvedValueOnce({ value: "true" })
      .mockResolvedValueOnce(null);
    mockPrisma.favorite.findMany.mockResolvedValueOnce([{ userId: "u1" }]);
    mockPrisma.orderItem.findMany.mockResolvedValueOnce([]);
    mockPrisma.user.findMany.mockResolvedValueOnce([{ id: "u1" }]);
    mockPrisma.restockNotificationJob.findFirst.mockResolvedValueOnce({
      id: "job-1",
      status: "COMPLETED",
      entries: [],
      scheduledSendAt: null,
    });

    await enqueueRestockForProductColor("pc3", "t1");

    expect(mockPrisma.restockNotificationJob.update).toHaveBeenCalledTimes(1);
    const updateArgs = mockPrisma.restockNotificationJob.update.mock.calls[0][0];
    expect(updateArgs.data.status).toBe("PENDING");
    expect(updateArgs.data.scheduledSendAt).toBeInstanceOf(Date);
    const entries = updateArgs.data.entries as RestockEntry[];
    expect(entries).toHaveLength(1);
    expect(entries[0].productColorId).toBe("pc3");
  });

  it("ne crée aucun job si aucun user n'est éligible (opt-out global)", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc1",
      stock: 5,
      saleType: "UNIT",
      product: { id: "p1", status: "ONLINE", tenantId: "t1" },
    });
    mockPrisma.siteConfig.findFirst
      .mockResolvedValueOnce({ value: "true" })
      .mockResolvedValueOnce(null);
    mockPrisma.favorite.findMany.mockResolvedValueOnce([{ userId: "u1" }]);
    mockPrisma.orderItem.findMany.mockResolvedValueOnce([]);
    // user.findMany simule le filtre non-APPROVED / opt-out / newsletter off.
    mockPrisma.user.findMany.mockResolvedValueOnce([]);

    await enqueueRestockForProductColor("pc1", "t1");

    expect(mockPrisma.restockNotificationJob.create).not.toHaveBeenCalled();
    expect(mockPrisma.restockNotificationJob.update).not.toHaveBeenCalled();
  });

  it("union favoris + commandes historiques, flags isFavorite/hasOrdered posés correctement", async () => {
    mockPrisma.productColor.findUnique.mockResolvedValueOnce({
      id: "pc1",
      stock: 5,
      saleType: "UNIT",
      product: { id: "p1", status: "ONLINE", tenantId: "t1" },
    });
    mockPrisma.siteConfig.findFirst
      .mockResolvedValueOnce({ value: "true" })
      .mockResolvedValueOnce(null);
    mockPrisma.favorite.findMany.mockResolvedValueOnce([
      { userId: "u-fav-only" },
      { userId: "u-both" },
    ]);
    mockPrisma.orderItem.findMany.mockResolvedValueOnce([
      { order: { userId: "u-order-only" } },
      { order: { userId: "u-both" } },
    ]);
    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: "u-fav-only" },
      { id: "u-order-only" },
      { id: "u-both" },
    ]);
    mockPrisma.restockNotificationJob.findFirst.mockResolvedValue(null);

    await enqueueRestockForProductColor("pc1", "t1");

    expect(mockPrisma.restockNotificationJob.create).toHaveBeenCalledTimes(3);
    const flagsByUser: Record<string, { isFavorite: boolean; hasOrdered: boolean }> = {};
    for (const call of mockPrisma.restockNotificationJob.create.mock.calls) {
      const data = (call[0] as { data: { userId: string; entries: RestockEntry[] } }).data;
      flagsByUser[data.userId] = {
        isFavorite: data.entries[0].isFavorite,
        hasOrdered: data.entries[0].hasOrdered,
      };
    }
    expect(flagsByUser["u-fav-only"]).toEqual({ isFavorite: true, hasOrdered: false });
    expect(flagsByUser["u-order-only"]).toEqual({ isFavorite: false, hasOrdered: true });
    expect(flagsByUser["u-both"]).toEqual({ isFavorite: true, hasOrdered: true });
  });

  it("10 retours en stock successifs pour un client = 1 seul job avec 10 entries", async () => {
    // Scenario : 10 produits reviennent en stock dans la fenêtre 24 h.
    // On simule 10 appels successifs à enqueueRestockForProductColor.
    const existingEntries: RestockEntry[] = [];
    const originalScheduled = new Date("2026-01-01T10:00:00.000Z");

    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1" }]);
    mockPrisma.favorite.findMany.mockResolvedValue([{ userId: "u1" }]);
    mockPrisma.orderItem.findMany.mockResolvedValue([]);

    mockPrisma.restockNotificationJob.findFirst.mockImplementation(async () => {
      if (existingEntries.length === 0) return null;
      return {
        id: "job-1",
        status: "PENDING",
        entries: existingEntries.slice(),
        scheduledSendAt: originalScheduled,
      };
    });

    mockPrisma.restockNotificationJob.create.mockImplementation(async (args: { data: { entries: RestockEntry[] } }) => {
      existingEntries.push(...args.data.entries);
      return { id: "job-1" };
    });

    mockPrisma.restockNotificationJob.update.mockImplementation(async (args: { data: { entries?: RestockEntry[] } }) => {
      if (args.data.entries) {
        existingEntries.length = 0;
        existingEntries.push(...args.data.entries);
      }
      return { id: "job-1" };
    });

    for (let i = 0; i < 10; i++) {
      mockPrisma.productColor.findUnique.mockResolvedValueOnce({
        id: `pc${i}`,
        stock: 5,
        saleType: "UNIT",
        product: { id: `p${i}`, status: "ONLINE", tenantId: "t1" },
      });
      mockPrisma.siteConfig.findFirst
        .mockResolvedValueOnce({ value: "true" })
        .mockResolvedValueOnce(null);
      await enqueueRestockForProductColor(`pc${i}`, "t1");
    }

    expect(mockPrisma.restockNotificationJob.create).toHaveBeenCalledTimes(1); // 1 création
    expect(mockPrisma.restockNotificationJob.update).toHaveBeenCalledTimes(9); // 9 appends
    expect(existingEntries).toHaveLength(10);
    // Compteur jamais réinitialisé pendant les appends : le 1er job seul porte scheduledSendAt.
    const resetCalls = mockPrisma.restockNotificationJob.update.mock.calls.filter(
      (c) => (c[0] as { data: { scheduledSendAt?: Date } }).data.scheduledSendAt !== undefined,
    );
    expect(resetCalls).toHaveLength(0);
  });
});
