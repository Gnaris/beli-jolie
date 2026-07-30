/**
 * Tests du comportement de liaison Ankorstore vis-à-vis de `external_id` côté AS.
 *
 * Historique : le commit daa2ecc (Fix 1) refusait toute liaison si le produit
 * Ankorstore n'avait pas d'external_id égal à notre référence. Trop strict :
 * bloquait la cliente sur tous les anciens produits AS (importés Excel ou
 * créés à la main sur le back-office AS) qui n'ont pas d'external_id posé.
 *
 * Nouveau comportement (2026-07-30) : la liaison passe TOUJOURS, avec un
 * warning loggué en cas d'external_id vide ou mismatched. La protection
 * anti-doublon effective est portée par Fix 2 dans lib/ankorstore-update.ts
 * (voir __tests__/lib/ankorstore-update.test.ts « Fix 2a/2b/2c »).
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
const loggerMock = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock("@/lib/logger", () => ({ logger: loggerMock }));
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

vi.mock("@/lib/ankorstore-match", () => ({
  runAutoMatch: vi.fn().mockReturnValue({
    results: [{ variantMatches: [] }],
  }),
}));

vi.mock("@/lib/ankorstore-variant-link", () => ({
  autoLinkAnkorstoreVariants: vi.fn().mockResolvedValue({
    matchedExact: 0,
    matchedColor: 0,
    stillUnlinked: [],
  }),
}));

vi.mock("@/lib/ankorstore-update", () => ({
  ankorstoreKickoffUpdate: vi
    .fn()
    .mockResolvedValue({ success: true, operationId: null, archived: false }),
}));

const {
  linkAnkorstoreProductWithMapping,
  linkAnkorstoreProductManually,
} = await import("@/app/actions/admin/ankorstore");

describe("Liaison Ankorstore — tolérance sur external_id (protection déportée sur Fix 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.product.findUnique.mockReset();
    prismaMock.product.update.mockReset();
    prismaMock.productColor.updateMany.mockReset();
    ankorApiMock.ankorstoreGetProduct.mockReset();
    loggerMock.warn.mockReset();
  });

  it("linkAnkorstoreProductWithMapping : autorise la liaison si external_id AS = null (ancien produit Excel) + logge un warning", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ reference: "A99" });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: null,
      variants: [{ id: "ank-v-1", sku: "A99" }],
    });

    const res = await linkAnkorstoreProductWithMapping(
      "bj-product-1",
      "ank-p-1",
      [{ ankorstoreVariantId: "ank-v-1", localColorId: "color-1" }],
    );

    expect(res.success).toBe(true);
    expect(prismaMock.product.update).toHaveBeenCalled();
    // Warning tracé pour audit
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("sans external_id"),
      expect.objectContaining({ bjReference: "A99" }),
    );
  });

  it("linkAnkorstoreProductWithMapping : autorise la liaison si external_id AS ≠ ref BJ + logge un warning explicite", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ reference: "A99" });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: "AUTRE_REF",
      variants: [{ id: "ank-v-1", sku: "AUTRE_REF_red_1" }],
    });

    const res = await linkAnkorstoreProductWithMapping(
      "bj-product-1",
      "ank-p-1",
      [{ ankorstoreVariantId: "ank-v-1", localColorId: "color-1" }],
    );

    expect(res.success).toBe(true);
    expect(prismaMock.product.update).toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("external_id différent"),
      expect.objectContaining({ asExternalId: "AUTRE_REF", bjReference: "A99" }),
    );
  });

  it("linkAnkorstoreProductWithMapping : ne logge PAS de warning si external_id AS = ref BJ (cas nominal)", async () => {
    prismaMock.product.findUnique.mockResolvedValue({ reference: "A99" });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: "A99",
      variants: [{ id: "ank-v-1", sku: "A99_red_1" }],
    });

    const res = await linkAnkorstoreProductWithMapping(
      "bj-product-1",
      "ank-p-1",
      [{ ankorstoreVariantId: "ank-v-1", localColorId: "color-1" }],
    );

    expect(res.success).toBe(true);
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it("linkAnkorstoreProductManually : autorise aussi la liaison même si external_id AS = null", async () => {
    prismaMock.product.findUnique.mockResolvedValue({
      id: "bj-product-1",
      name: "T shirt",
      reference: "A99",
      colors: [],
    });
    ankorApiMock.ankorstoreGetProduct.mockResolvedValue({
      id: "ank-p-1",
      externalId: null,
      variants: [],
    });

    const res = await linkAnkorstoreProductManually("bj-product-1", "ank-p-1");

    expect(res.success).toBe(true);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("sans external_id"),
      expect.any(Object),
    );
  });
});
