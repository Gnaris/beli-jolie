/**
 * Régression A264 (03/08/2026) : un update PFS aborted côté worker déclenchait
 * un fallback catastrophique — reset pfsProductId + retry pfsCreateProduct —
 * qui échouait ensuite avec « Référence non valide » car la fiche existait
 * toujours côté PFS. Le lien était perdu en base sans possibilité de
 * republier.
 *
 * Depuis : le worker NE recrée JAMAIS un produit PFS après un update échoué.
 * Il retourne une erreur claire et laisse `pfsProductId` intact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const {
  mockProductFindUnique,
  mockProductUpdate,
  mockProductColorUpdateMany,
  mockJobUpdate,
  pfsUpdateInPlaceSpy,
  pfsPublishSpy,
  getCachedPfsEnabledSpy,
} = vi.hoisted(() => ({
  mockProductFindUnique: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockProductColorUpdateMany: vi.fn(),
  mockJobUpdate: vi.fn(),
  pfsUpdateInPlaceSpy: vi.fn(),
  pfsPublishSpy: vi.fn(),
  getCachedPfsEnabledSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
    productColor: {
      updateMany: (...a: unknown[]) => mockProductColorUpdateMany(...a),
    },
    marketplaceRefreshJob: {
      update: (...a: unknown[]) => mockJobUpdate(...a),
    },
  },
}));

vi.mock("@/lib/pfs-update", () => ({
  pfsUpdateProductInPlace: pfsUpdateInPlaceSpy,
}));
vi.mock("@/lib/pfs-publish", () => ({
  pfsPublishProduct: pfsPublishSpy,
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedPfsEnabled: getCachedPfsEnabledSpy,
}));

vi.mock("@/lib/platform-config", () => ({
  isMarketplaceInMaintenance: vi.fn().mockResolvedValue(false),
  getMarketplaceMaintenance: vi.fn().mockResolvedValue({}),
  marketplaceMaintenanceMessage: (mp: string) => `${mp} en maintenance`,
}));

vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { runPfsJob, type JobRow, type QueueJobPayload } from "@/lib/marketplace-queue-worker";

const jobPayloadJson = {
  reference: "A264",
  productName: "Bracelet",
  firstImage: null,
  options: { pfs: true, ankorstore: false, efashion: false, faire: false, local: false },
} as unknown as Prisma.JsonValue;

function makeJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "job-1",
    productId: "p-1",
    mode: "PUBLISH",
    status: "IN_PROGRESS",
    payload: jobPayloadJson,
    localOutcome: null,
    pfsOutcome: null,
    ankorsOutcome: null,
    efashionOutcome: null,
    faireOutcome: null,
    ankorsOperationId: null,
    errorMessage: null,
    scheduledFor: null,
    createdAt: new Date(),
    startedAt: new Date(),
    completedAt: null,
    tenantId: "t-1",
    ...overrides,
  } as unknown as JobRow;
}

const payload: QueueJobPayload = {
  reference: "A264",
  productName: "Bracelet",
  firstImage: null,
  options: { pfs: true, ankorstore: false, efashion: false, faire: false, local: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  getCachedPfsEnabledSpy.mockResolvedValue(true);
});

describe("runPfsJob — anti-fallback publish", () => {
  it("NE recrée PAS le produit PFS quand l'update échoue (régression A264)", async () => {
    mockProductFindUnique.mockResolvedValue({ pfsProductId: "existing_pfs" });
    pfsUpdateInPlaceSpy.mockResolvedValue({
      success: false,
      error: "This operation was aborted",
    });

    await runPfsJob(makeJob({ mode: "PUBLISH" }), payload);

    expect(pfsUpdateInPlaceSpy).toHaveBeenCalledOnce();
    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockProductColorUpdateMany).not.toHaveBeenCalled();

    const jobUpdate = mockJobUpdate.mock.calls[0]?.[0] as {
      data: { status: string; pfsOutcome: { ok: boolean; message: string }; errorMessage: string };
    };
    expect(jobUpdate.data.status).toBe("FAILED");
    expect(jobUpdate.data.pfsOutcome.ok).toBe(false);
    expect(jobUpdate.data.pfsOutcome.message).toContain("This operation was aborted");
    expect(jobUpdate.data.pfsOutcome.message).toContain("Aucun produit n'a été recréé");
  });

  it("publie normalement quand pfsProductId est null (1ʳᵉ publication légitime)", async () => {
    mockProductFindUnique.mockResolvedValue({ pfsProductId: null });
    pfsPublishSpy.mockResolvedValue({ success: true, archived: false });

    await runPfsJob(makeJob({ mode: "PUBLISH" }), payload);

    expect(pfsPublishSpy).toHaveBeenCalledOnce();
    expect(pfsUpdateInPlaceSpy).not.toHaveBeenCalled();

    const jobUpdate = mockJobUpdate.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(jobUpdate.data.status).toBe("SUCCEEDED");
  });

  it("update passe : status SUCCEEDED, aucun reset d'ID", async () => {
    mockProductFindUnique.mockResolvedValue({ pfsProductId: "existing_pfs" });
    pfsUpdateInPlaceSpy.mockResolvedValue({ success: true, archived: false });

    await runPfsJob(makeJob({ mode: "PUBLISH" }), payload);

    expect(pfsUpdateInPlaceSpy).toHaveBeenCalledOnce();
    expect(pfsPublishSpy).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockProductColorUpdateMany).not.toHaveBeenCalled();

    const jobUpdate = mockJobUpdate.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(jobUpdate.data.status).toBe("SUCCEEDED");
  });
});
