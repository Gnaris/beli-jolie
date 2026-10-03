/**
 * Garantit que commitLocalPatch déclenche rotatePrimaryIfNeeded quand un pull
 * PFS touche le stock ou la visibilité d'une variante — mais pas quand il ne
 * touche que le prix ou le poids.
 *
 * Angle : si PFS désactive une variante ou passe son stock à 0 et que c'est
 * la couleur principale, l'audit auto doit basculer la primary vers une autre
 * couleur en stock AVANT que la propagation marketplace ne parte avec la
 * mauvaise première image (cf. CLAUDE.md §Refresh produit, règle 2026-10-03).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, rotateMock } = vi.hoisted(() => {
  const tx = {
    product: { update: vi.fn().mockResolvedValue({}) },
    productComposition: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    productColor: { update: vi.fn().mockResolvedValue({}) },
  };
  return {
    prismaMock: {
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => {
        await fn(tx);
      }),
      __tx: tx,
    },
    rotateMock: vi.fn().mockResolvedValue({ rotated: false }),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/rotate-primary-service", () => ({
  rotatePrimaryIfNeeded: rotateMock,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/pfs-api", () => ({
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsUpdateProduct: vi.fn(),
  pfsPatchVariants: vi.fn(),
  pfsSetVariantsAvailability: vi.fn(),
  pfsUpdateStatus: vi.fn(),
}));
vi.mock("@/lib/pfs-status", () => ({ mapLocalToPfsStatus: vi.fn() }));
vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn(),
  loadMarketplaceMarkupConfigs: vi.fn(),
}));
vi.mock("@/lib/pfs-verify-variant-ops", () => ({
  pushAddPfsVariantFromLocal: vi.fn(),
  pushRemovePfsVariant: vi.fn(),
  pullAddLocalVariantFromPfs: vi.fn(),
  pullRemoveLocalVariant: vi.fn(),
}));
vi.mock("@/lib/pfs-admin-api", () => ({
  pfsAdminFetchMaterialComposition: vi.fn(),
  normalizeDictKey: (s: string) => s.toUpperCase(),
}));
vi.mock("@/lib/pfs-import", () => ({ createOrLinkMapping: vi.fn() }));

import { commitLocalPatch } from "@/lib/pfs-verify-apply";

// LocalRow est interne — un simple cast suffit, commitLocalPatch n'utilise
// que local.tenantId et les flags *ProductId pour poser *SyncRequired.
const makeLocal = () =>
  ({
    tenantId: "t-test",
    ankorsProductId: null,
    efashionReferenceBase: null,
    faireProductId: null,
  }) as unknown as Parameters<typeof commitLocalPatch>[1];

const productId = "prod-123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commitLocalPatch — rotation couleur principale", () => {
  it("appelle rotatePrimaryIfNeeded quand un pull touche le stock d'une variante", async () => {
    await commitLocalPatch(productId, makeLocal(), {
      product: {},
      variants: new Map([["var-rose", { stock: 0 }]]),
    });
    expect(rotateMock).toHaveBeenCalledTimes(1);
    expect(rotateMock).toHaveBeenCalledWith(productId, { immediate: true });
  });

  it("appelle rotatePrimaryIfNeeded quand un pull désactive une variante", async () => {
    await commitLocalPatch(productId, makeLocal(), {
      product: {},
      variants: new Map([["var-noir", { disabled: true }]]),
    });
    expect(rotateMock).toHaveBeenCalledTimes(1);
    expect(rotateMock).toHaveBeenCalledWith(productId, { immediate: true });
  });

  it("n'appelle PAS rotatePrimaryIfNeeded si le pull ne touche que le prix ou le poids", async () => {
    await commitLocalPatch(productId, makeLocal(), {
      product: {},
      variants: new Map([
        ["var-rose", { unitPrice: 12.5 }],
        ["var-noir", { weight: 50 }],
      ]),
    });
    expect(rotateMock).not.toHaveBeenCalled();
  });

  it("n'appelle PAS rotatePrimaryIfNeeded si aucune variante n'est patchée", async () => {
    await commitLocalPatch(productId, makeLocal(), {
      product: { name: "Nouveau nom" },
      variants: new Map(),
    });
    expect(rotateMock).not.toHaveBeenCalled();
  });
});
