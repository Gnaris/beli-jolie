/**
 * Tests du helper `dedupeEnqueueDrafts` — cœur de la règle « une seule
 * exécution QUEUED par (productId, marketplace, mode) » partagée par les 3
 * callers (route API, audit PFS auto, rotation couleur principale).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketplaceRefreshJob: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { dedupeEnqueueDrafts } from "@/lib/marketplace-queue-dedupe";

function stubJob(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    productId: "p1",
    marketplace: "FAIRE",
    mode: "REFRESH",
    status: "QUEUED",
    payload: {},
    intent: "REFRESH",
    createdAt: new Date("2026-09-08T00:00:00Z"),
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

describe("dedupeEnqueueDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retourne des listes vides quand aucun draft n'est fourni", async () => {
    const res = await dedupeEnqueueDrafts([]);
    expect(res).toEqual({ toCreate: [], reused: [], deduplicated: 0 });
    expect(prisma.marketplaceRefreshJob.findMany).not.toHaveBeenCalled();
  });

  it("skip la requête BDD si aucun draft en mode dédupliable", async () => {
    const drafts = [
      { productId: "p1", marketplace: "FAIRE" as const, mode: "DELETE" as const },
      { productId: "p2", marketplace: "FAIRE" as const, mode: "DISABLE" as const },
    ];
    const res = await dedupeEnqueueDrafts(drafts);
    expect(prisma.marketplaceRefreshJob.findMany).not.toHaveBeenCalled();
    expect(res.toCreate).toEqual(drafts);
    expect(res.deduplicated).toBe(0);
  });

  it("dédupliue un REFRESH quand un QUEUED existe pour même (product, mkt, mode)", async () => {
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([
      stubJob({ id: "existing", productId: "p1", marketplace: "FAIRE", mode: "REFRESH", status: "QUEUED" }),
    ] as never);

    const drafts = [
      { productId: "p1", marketplace: "FAIRE" as const, mode: "REFRESH" as const },
    ];
    const res = await dedupeEnqueueDrafts(drafts);
    expect(res.toCreate).toHaveLength(0);
    expect(res.reused).toHaveLength(1);
    expect(res.deduplicated).toBe(1);
  });

  it("ne dédupliue PAS si la marketplace diffère", async () => {
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([
      stubJob({ id: "existing", productId: "p1", marketplace: "FAIRE", mode: "REFRESH", status: "QUEUED" }),
    ] as never);

    const drafts = [
      { productId: "p1", marketplace: "ANKORSTORE" as const, mode: "REFRESH" as const },
    ];
    const res = await dedupeEnqueueDrafts(drafts);
    expect(res.toCreate).toEqual(drafts);
    expect(res.deduplicated).toBe(0);
  });

  it("ne dédupliue PAS si le mode diffère (REFRESH existe, DELETE demandé)", async () => {
    // Query filtre déjà sur les modes dédupliables — le findMany ne remonte
    // pas de DELETE. Mais un caller qui mélange REFRESH+DELETE dans le même
    // batch doit voir le REFRESH partir dans reused et le DELETE dans toCreate.
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([
      stubJob({ id: "existing", productId: "p1", marketplace: "FAIRE", mode: "REFRESH", status: "QUEUED" }),
    ] as never);

    const drafts = [
      { productId: "p1", marketplace: "FAIRE" as const, mode: "REFRESH" as const },
      { productId: "p1", marketplace: "FAIRE" as const, mode: "DELETE" as const },
    ];
    const res = await dedupeEnqueueDrafts(drafts);
    expect(res.deduplicated).toBe(1);
    expect(res.toCreate).toHaveLength(1);
    expect(res.toCreate[0].mode).toBe("DELETE");
  });

  it("filtre la query BDD sur status='QUEUED' uniquement (pas IN_PROGRESS)", async () => {
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([] as never);

    await dedupeEnqueueDrafts([
      { productId: "p1", marketplace: "FAIRE" as const, mode: "REFRESH" as const },
    ]);

    const call = vi.mocked(prisma.marketplaceRefreshJob.findMany).mock.calls[0][0];
    expect((call as { where: { status: unknown } }).where.status).toBe("QUEUED");
    // Motivation : un job IN_PROGRESS a peut-être déjà lu l'état produit, on
    // veut qu'un nouveau job s'empile derrière pour ne pas perdre les modifs.
  });

  it("préserve la forme originale du draft dans toCreate (generics)", async () => {
    vi.mocked(prisma.marketplaceRefreshJob.findMany).mockResolvedValue([] as never);

    interface EnrichedDraft {
      productId: string;
      marketplace: "FAIRE";
      mode: "REFRESH";
      customField: string;
    }
    const drafts: EnrichedDraft[] = [
      { productId: "p1", marketplace: "FAIRE", mode: "REFRESH", customField: "hello" },
    ];
    const res = await dedupeEnqueueDrafts(drafts);
    expect(res.toCreate).toHaveLength(1);
    // Le champ custom doit passer intact à travers le helper.
    expect(res.toCreate[0].customField).toBe("hello");
  });
});
