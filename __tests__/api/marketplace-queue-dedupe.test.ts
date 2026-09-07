/**
 * Tests pour POST /api/admin/marketplace-queue — comportement de dédoublonnage.
 *
 * Contrat : si un job actif (QUEUED / IN_PROGRESS / AWAITING_CALLBACK) existe
 * déjà pour le même (productId, marketplace, mode), un nouvel enqueue avec le
 * même triplet ne recrée PAS de doublon — il renvoie le job existant dans
 * `items` et l'incrémente dans `deduplicated`.
 *
 * Motivation : incident 2026-09-07 côté issyma — une modif de mapping globale
 * (composition/catégorie) déclenche N modales successives ; chaque clic
 * "Synchroniser maintenant" refourguait les mêmes produits × marketplace dans
 * la file. Résultat : ~700 doublons Faire à traiter à 2 jobs/min → 6 h de queue.
 * Le dédoublonnage garantit un job actif unique par (produit, marketplace, mode).
 *
 * DELETE / DISABLE / ENABLE restent hors du dédoublonnage : ce sont des
 * actions ponctuelles distinctes qu'on doit toujours pouvoir enfiler même
 * pendant qu'un REFRESH est en file. Idem pour les jobs avec `verifyActions`
 * (chemin PfsVerify granulaire, pas une sync marketplace standard).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/marketplace-enabled", () => ({
  getProductsMarketplaceEnabled: vi.fn(),
}));

vi.mock("@/lib/marketplace-job-intent", () => ({
  resolveJobIntentsBulk: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketplaceRefreshJob: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { getProductsMarketplaceEnabled } from "@/lib/marketplace-enabled";
import { resolveJobIntentsBulk } from "@/lib/marketplace-job-intent";
import { POST } from "@/app/api/admin/marketplace-queue/route";

interface EnqueuedItem {
  productId: string;
  marketplace: "pfs" | "ankorstore" | "efashion" | "faire" | "orderchamp" | "microstore";
  mode?: "publish" | "refresh" | "resync" | "disable" | "enable" | "delete";
}

function makeReq(items: EnqueuedItem[]): Request {
  return new Request("http://localhost/api/admin/marketplace-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: items.map((i) => ({
        productId: i.productId,
        reference: `ref-${i.productId}`,
        productName: `name-${i.productId}`,
        firstImage: null,
        options: {},
        mode: i.mode ?? "refresh",
        marketplace: i.marketplace,
      })),
    }),
  });
}

function stubJob(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    productId: "p1",
    marketplace: "FAIRE",
    mode: "REFRESH",
    status: "QUEUED",
    payload: {
      reference: "ref-p1",
      productName: "name-p1",
      firstImage: null,
      options: {},
    },
    intent: "REFRESH",
    createdAt: new Date("2026-09-07T15:00:00Z"),
    scheduledFor: null,
    startedAt: null,
    completedAt: null,
    localOutcome: null,
    pfsOutcome: null,
    ankorsOutcome: null,
    efashionOutcome: null,
    faireOutcome: null,
    orderchampOutcome: null,
    microstoreOutcome: null,
    ankorsOperationId: null,
    errorMessage: null,
    tenantId: "issyma",
    steps: null,
    ...overrides,
  };
}

describe("POST /api/admin/marketplace-queue — dédoublonnage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN" },
    } as never);
    vi.mocked(getProductsMarketplaceEnabled).mockResolvedValue(
      new Map([
        ["p1", { pfs: true, ankorstore: true, efashion: true, faire: true, orderchamp: true, microstore: true }],
        ["p2", { pfs: true, ankorstore: true, efashion: true, faire: true, orderchamp: true, microstore: true }],
      ]),
    );
    vi.mocked(resolveJobIntentsBulk).mockImplementation(async (inputs) =>
      inputs.map(() => "REFRESH"),
    );
    vi.mocked(prisma.$transaction).mockImplementation(async (arg) => {
      if (typeof arg === "function") return arg(prisma);
      return Promise.all(arg as Promise<unknown>[]);
    });
  });

  it("saute un enqueue si un job REFRESH FAIRE actif existe déjà pour ce produit", async () => {
    const existing = stubJob({
      id: "existing-1",
      productId: "p1",
      marketplace: "FAIRE",
      mode: "REFRESH",
      status: "QUEUED",
    });
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([existing] as never);

    const res = await POST(makeReq([{ productId: "p1", marketplace: "faire", mode: "refresh" }]) as never);
    const body = (await res.json()) as { created: number; deduplicated?: number; items: unknown[] };

    expect(res.status).toBe(200);
    expect(body.created).toBe(0);
    expect(body.deduplicated).toBe(1);
    expect(prisma.marketplaceRefreshJob.create).not.toHaveBeenCalled();
    // Renvoie l'existant pour que le widget UI reste cohérent (badge « en file »)
    expect(body.items).toHaveLength(1);
    expect((body.items[0] as { id: string }).id).toBe("existing-1");
  });

  it("crée le job si aucun doublon actif ne matche", async () => {
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([] as never);
    const created = stubJob({ id: "new-1", productId: "p1", marketplace: "FAIRE", mode: "REFRESH" });
    vi.mocked(prisma.marketplaceRefreshJob.create).mockResolvedValue(created as never);

    const res = await POST(makeReq([{ productId: "p1", marketplace: "faire", mode: "refresh" }]) as never);
    const body = (await res.json()) as { created: number; deduplicated?: number };

    expect(res.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.deduplicated ?? 0).toBe(0);
    expect(prisma.marketplaceRefreshJob.create).toHaveBeenCalledTimes(1);
  });

  it("ne dédupliue PAS si le mode diffère (REFRESH existe, DELETE demandé)", async () => {
    const existing = stubJob({
      id: "existing-refresh",
      productId: "p1",
      marketplace: "FAIRE",
      mode: "REFRESH",
      status: "QUEUED",
    });
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([existing] as never);
    const created = stubJob({ id: "new-delete", productId: "p1", marketplace: "FAIRE", mode: "DELETE" });
    vi.mocked(prisma.marketplaceRefreshJob.create).mockResolvedValue(created as never);

    const res = await POST(makeReq([{ productId: "p1", marketplace: "faire", mode: "delete" }]) as never);
    const body = (await res.json()) as { created: number; deduplicated?: number };

    expect(res.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.deduplicated ?? 0).toBe(0);
  });

  it("ne dédupliue PAS si la marketplace diffère (FAIRE existe, ANKORSTORE demandé)", async () => {
    const existing = stubJob({
      id: "existing-faire",
      productId: "p1",
      marketplace: "FAIRE",
      mode: "REFRESH",
      status: "QUEUED",
    });
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([existing] as never);
    const created = stubJob({ id: "new-ankor", productId: "p1", marketplace: "ANKORSTORE", mode: "REFRESH" });
    vi.mocked(prisma.marketplaceRefreshJob.create).mockResolvedValue(created as never);

    const res = await POST(makeReq([{ productId: "p1", marketplace: "ankorstore", mode: "refresh" }]) as never);
    const body = (await res.json()) as { created: number; deduplicated?: number };

    expect(res.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.deduplicated ?? 0).toBe(0);
  });

  it("N'ignore PAS un job IN_PROGRESS — enfile un nouveau job derrière (chaînage par produit)", async () => {
    // findMany filtre déjà sur status="QUEUED" côté route → un IN_PROGRESS ne
    // remonte pas ici. On mock donc un findMany qui retourne vide malgré
    // l'existence (théorique) d'un IN_PROGRESS côté BDD.
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([] as never);
    const created = stubJob({ id: "chained-p1", productId: "p1", marketplace: "ANKORSTORE", mode: "REFRESH" });
    vi.mocked(prisma.marketplaceRefreshJob.create).mockResolvedValue(created as never);

    const res = await POST(
      makeReq([{ productId: "p1", marketplace: "ankorstore", mode: "refresh" }]) as never,
    );
    const body = (await res.json()) as { created: number; deduplicated?: number };

    expect(res.status).toBe(200);
    // Motivation : une modif produit faite pendant qu'un push est en cours
    // doit être poussée par un 2ᵉ job — sinon la modif disparaît. Le worker
    // sérialise déjà par productId, le nouveau job attendra son tour.
    expect(body.created).toBe(1);
    expect(body.deduplicated ?? 0).toBe(0);
    expect(prisma.marketplaceRefreshJob.create).toHaveBeenCalledTimes(1);
    // Vérifie que la route ne cherche QUE dans les QUEUED — pas les en cours
    const findManyCall = vi.mocked(prisma.marketplaceRefreshJob.findMany).mock.calls[0]?.[0];
    expect((findManyCall as { where: { status: unknown } }).where.status).toBe("QUEUED");
  });

  it("mélange dédupliqué + créé dans le même batch — chaque item est traité indépendamment", async () => {
    // p1/FAIRE déjà en file, p2/FAIRE non
    const existing = stubJob({
      id: "existing-p1",
      productId: "p1",
      marketplace: "FAIRE",
      mode: "REFRESH",
      status: "QUEUED",
    });
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([existing] as never);
    const created = stubJob({ id: "new-p2", productId: "p2", marketplace: "FAIRE", mode: "REFRESH" });
    vi.mocked(prisma.marketplaceRefreshJob.create).mockResolvedValue(created as never);

    const res = await POST(
      makeReq([
        { productId: "p1", marketplace: "faire", mode: "refresh" },
        { productId: "p2", marketplace: "faire", mode: "refresh" },
      ]) as never,
    );
    const body = (await res.json()) as { created: number; deduplicated?: number; items: unknown[] };

    expect(res.status).toBe(200);
    expect(body.created).toBe(1);
    expect(body.deduplicated).toBe(1);
    expect(prisma.marketplaceRefreshJob.create).toHaveBeenCalledTimes(1);
    // Response contient le nouveau + le réutilisé
    expect(body.items).toHaveLength(2);
  });
});
