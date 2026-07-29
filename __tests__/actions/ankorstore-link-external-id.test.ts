/**
 * Tests Fix 1 : garde-fou anti-doublon sur la liaison Ankorstore.
 *
 * `linkAnkorstoreProductWithMapping` et `linkAnkorstoreProductManually`
 * refusent de lier un produit BJ à un produit Ankorstore dont `external_id`
 * est nul ou différent de notre référence — sinon la synchro post-liaison
 * créerait un doublon côté marketplace (incident JG6 Issyma 2026-07-29).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "u", role: "ADMIN", status: "APPROVED" } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/tenant", () => ({
  requireCurrentTenant: vi
    .fn()
    .mockResolvedValue({ id: "tenant-1", slug: "bj", name: "BJ" }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

const prismaMock: any = {
  product: { findUnique: vi.fn(), update: vi.fn() },
  productColor: { updateMany: vi.fn() },
  $transaction: vi.fn(async (fn: any) =>
    typeof fn === "function" ? fn(prismaMock) : fn,
  ),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const ankorApiMock = {
  ankorstoreGetProduct: vi.fn(),
};
vi.mock("@/lib/ankorstore-api", () => ankorApiMock);

// runAutoMatch (utilisé par linkAnkorstoreProductManually) — mocké pour ne
// pas appeler la vraie logique de match.
vi.mock("@/lib/ankorstore-match", () => ({
  runAutoMatch: vi.fn().mockReturnValue({
    results: [{ variantMatches: [] }],
  }),
}));

// Filet post-liaison — pas testé ici.
vi.mock("@/lib/ankorstore-variant-link", () => ({
  autoLinkAnkorstoreVariants: vi.fn().mockResolvedValue({
    matchedExact: 0,
    matchedColor: 0,
    stillUnlinked: [],
  }),
}));

// kickoffOverwriteFromLink appelle ankorstoreKickoffUpdate — mocké.
vi.mock("@/lib/ankorstore-update", () => ({
  ankorstoreKickoffUpdate: vi
    .fn()
    .mockResolvedValue({ success: true, operationId: null, archived: false }),
}));

const {
  linkAnkorstoreProductWithMapping,
  linkAnkorstoreProductManually,
} = await import("@/app/actions/admin/ankorstore");

describe("Fix 1 — refus de liaison sur external_id incompatible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.product.findUnique.mockReset();
    prismaMock.product.update.mockReset();
    ankorApiMock.ankorstoreGetProduct.mockReset();
  });

  it("linkAnkorstoreProductWithMapping : refuse si external_id AS = null (incident JG6)", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ reference: "JG6" });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: null,
      variants: [{ id: "ank-v-1", sku: "JG6" }],
    });

    const res = await linkAnkorstoreProductWithMapping(
      "bj-product-1",
      "ank-p-1",
      [{ ankorstoreVariantId: "ank-v-1", localColorId: "color-1" }],
    );

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/référence externe|external_id/i);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });

  it("linkAnkorstoreProductWithMapping : refuse si external_id AS ≠ référence BJ", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ reference: "JG6" });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: "SOMETHING_ELSE",
      variants: [{ id: "ank-v-1", sku: "SOMETHING_ELSE_red_1" }],
    });

    const res = await linkAnkorstoreProductWithMapping(
      "bj-product-1",
      "ank-p-1",
      [{ ankorstoreVariantId: "ank-v-1", localColorId: "color-1" }],
    );

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toContain("SOMETHING_ELSE");
    expect(res.error).toContain("JG6");
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });

  it("linkAnkorstoreProductManually : refuse aussi (legacy path)", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: "bj-product-1",
      name: "T shirt",
      reference: "JG6",
      colors: [],
    });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: null,
      variants: [],
    });

    const res = await linkAnkorstoreProductManually("bj-product-1", "ank-p-1");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/référence externe|external_id/i);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });
});
