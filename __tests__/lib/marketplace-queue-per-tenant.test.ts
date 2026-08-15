/**
 * __tests__/lib/marketplace-queue-per-tenant.test.ts
 *
 * Vérifie l'isolation par tenant du worker marketplace (2026-08-15).
 *
 * Avant : file globale, un tenant qui push 100 produits monopolisait les 10
 * slots pendant plusieurs minutes → les autres boutiques attendaient.
 *
 * Après : chaque tenant a son propre budget (5 total, 5 Ankor, 2 Faire), les
 * queries prisma filtrent par tenantId, et le worker itère sur les tenants
 * indépendamment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockJobFindMany,
  mockJobCount,
  mockJobUpdateMany,
  mockProductFindUnique,
} = vi.hoisted(() => ({
  mockJobFindMany: vi.fn(),
  mockJobCount: vi.fn(),
  mockJobUpdateMany: vi.fn(),
  mockProductFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketplaceRefreshJob: {
      findMany: (...a: unknown[]) => mockJobFindMany(...a),
      count: (...a: unknown[]) => mockJobCount(...a),
      updateMany: (...a: unknown[]) => mockJobUpdateMany(...a),
      update: vi.fn(),
    },
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/product-url-server", () => ({
  revalidateProductPublicPage: vi.fn(),
}));
vi.mock("@/lib/marketplace-job-steps", () => ({ markStep: vi.fn() }));
vi.mock("@/lib/tenant-als", () => ({
  tenantALS: { run: (_tid: string, fn: () => unknown) => fn() },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { startQueued } from "@/lib/marketplace-queue-worker";

type FindManyArgs = { where?: Record<string, unknown>; select?: unknown; distinct?: unknown };
type CountArgs = { where?: Record<string, unknown> };

/**
 * Construit un mock findMany qui répond différemment selon les paramètres :
 *  - distinct: ["tenantId"] → liste des tenants
 *  - where.status = "QUEUED" (sans distinct) → jobs queued du tenant
 *  - where.marketplace = ANKORSTORE, status IN_PROGRESS/AWAITING → in-flight Ankor
 */
function setupFindMany(byTenant: Record<string, Array<{ id: string; marketplace: string; productId: string; tenantId: string }>>) {
  mockJobFindMany.mockImplementation(async (args: FindManyArgs) => {
    // Distinct query → renvoie les tenants
    if (args.distinct && (args.distinct as string[]).includes("tenantId")) {
      return Object.keys(byTenant).map((tid) => ({ tenantId: tid }));
    }
    // In-flight Ankor query
    if (args.where?.marketplace === "ANKORSTORE") {
      return []; // Rien en vol côté Ankor pour ces tests
    }
    // Queued jobs pour un tenant donné
    const tid = args.where?.tenantId as string | null;
    if (tid && byTenant[tid]) return byTenant[tid];
    return [];
  });
}

describe("startQueued — isolation par tenant", () => {
  beforeEach(() => {
    mockJobFindMany.mockReset();
    mockJobCount.mockReset();
    mockJobUpdateMany.mockReset();
    mockProductFindUnique.mockReset();

    // Par défaut : aucun job en vol
    mockJobCount.mockResolvedValue(0);
    // Par défaut : le claim (updateMany QUEUED → IN_PROGRESS) réussit
    mockJobUpdateMany.mockResolvedValue({ count: 1 });
    // Produit dispo pour éviter les crashes dans processJob (fire-and-forget)
    mockProductFindUnique.mockResolvedValue({ locked: false });
  });

  it("filtre les queries count/findMany par tenantId", async () => {
    setupFindMany({
      "tenant-A": [
        { id: "jA1", marketplace: "PFS", productId: "pA1", tenantId: "tenant-A" },
      ],
    });

    await startQueued();

    // count() a été appelé avec tenantId dans le where
    const countCalls = mockJobCount.mock.calls as unknown as Array<[CountArgs]>;
    expect(countCalls.length).toBeGreaterThan(0);
    for (const [args] of countCalls) {
      expect(args.where?.tenantId).toBe("tenant-A");
    }
  });

  it("boucle sur chaque tenant indépendamment (2 tenants → 2 passes)", async () => {
    setupFindMany({
      "tenant-A": [
        { id: "jA1", marketplace: "PFS", productId: "pA1", tenantId: "tenant-A" },
      ],
      "tenant-B": [
        { id: "jB1", marketplace: "PFS", productId: "pB1", tenantId: "tenant-B" },
      ],
    });

    await startQueued();

    // 2 tenants → chacun a eu son count IN_PROGRESS
    const countCalls = mockJobCount.mock.calls as unknown as Array<[CountArgs]>;
    const tenantsQueried = new Set(countCalls.map(([a]) => a.where?.tenantId));
    expect(tenantsQueried.has("tenant-A")).toBe(true);
    expect(tenantsQueried.has("tenant-B")).toBe(true);

    // Chaque tenant a démarré 1 job (updateMany appelé au moins 2 fois)
    expect(mockJobUpdateMany.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("tenant B garde son budget si tenant A a 100 jobs en attente", async () => {
    // tenant-A a 100 jobs queued, tenant-B en a 5
    const tenantA = Array.from({ length: 100 }, (_, i) => ({
      id: `jA${i}`,
      marketplace: "PFS",
      productId: `pA${i}`,
      tenantId: "tenant-A",
    }));
    const tenantB = Array.from({ length: 5 }, (_, i) => ({
      id: `jB${i}`,
      marketplace: "PFS",
      productId: `pB${i}`,
      tenantId: "tenant-B",
    }));
    setupFindMany({ "tenant-A": tenantA, "tenant-B": tenantB });

    await startQueued();

    // Chaque tenant reçoit son budget de 5 → 5 jobs A + 5 jobs B = 10 claim
    const claimedIds = mockJobUpdateMany.mock.calls.map(
      ([args]: [{ where: { id: string } }]) => args.where.id,
    );
    const claimedA = claimedIds.filter((id: string) => id.startsWith("jA"));
    const claimedB = claimedIds.filter((id: string) => id.startsWith("jB"));

    expect(claimedA.length).toBe(5); // tenant-A limité à son budget
    expect(claimedB.length).toBe(5); // tenant-B a récupéré ses 5 slots
  });

  it("respecte le budget par tenant même si le tenant a 20 jobs queued", async () => {
    // Un seul tenant avec 20 jobs → doit être limité à 5
    const tenantA = Array.from({ length: 20 }, (_, i) => ({
      id: `jA${i}`,
      marketplace: "PFS",
      productId: `pA${i}`,
      tenantId: "tenant-A",
    }));
    setupFindMany({ "tenant-A": tenantA });

    await startQueued();

    // 5 jobs claim max (PER_TENANT_TOTAL_CONCURRENCY = 5)
    expect(mockJobUpdateMany.mock.calls.length).toBe(5);
  });

  it("respecte le budget Faire par tenant (max 2)", async () => {
    // 5 jobs Faire d'un même tenant → seulement 2 doivent démarrer
    const tenantA = Array.from({ length: 5 }, (_, i) => ({
      id: `fA${i}`,
      marketplace: "FAIRE",
      productId: `pA${i}`,
      tenantId: "tenant-A",
    }));
    setupFindMany({ "tenant-A": tenantA });

    await startQueued();

    // 2 jobs Faire max (PER_TENANT_FAIRE_CONCURRENCY = 2)
    expect(mockJobUpdateMany.mock.calls.length).toBe(2);
  });

  it("s'arrête tôt si aucun tenant n'a de job queued", async () => {
    setupFindMany({}); // aucun tenant

    await startQueued();

    // Le count IN_PROGRESS ne doit jamais être appelé (early return)
    expect(mockJobCount).not.toHaveBeenCalled();
    expect(mockJobUpdateMany).not.toHaveBeenCalled();
  });

  it("saute le tenant dont le budget est déjà épuisé (5 IN_PROGRESS)", async () => {
    setupFindMany({
      "tenant-A": [
        { id: "jA1", marketplace: "PFS", productId: "pA1", tenantId: "tenant-A" },
      ],
    });
    // 5 jobs déjà en vol chez tenant-A → budget 0
    mockJobCount.mockResolvedValue(5);

    await startQueued();

    // Aucun claim (pas de budget)
    expect(mockJobUpdateMany).not.toHaveBeenCalled();
  });
});
