/**
 * Tests du comportement « API admin (mobile) prioritaire » pour la
 * composition PFS.
 *
 * Contexte : la cliente saisit la composition via l'appli mobile PFS. Le
 * wholesaler renvoie parfois une valeur stale (bug de synchro côté PFS).
 * Depuis 2026-08-27, on lit mobile d'abord et on n'utilise wholesaler qu'en
 * fallback si mobile est vide ou HS.
 *
 * On teste directement `preferMobileComposition` (exporté depuis
 * pfs-verify-apply.ts) car les 3 endroits (pfs-verify, pfs-verify-apply,
 * pfs-import) implémentent la même logique.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    composition: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/pfs-import", () => ({ createOrLinkMapping: vi.fn() }));
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

const { fetchMobileMock } = vi.hoisted(() => ({
  fetchMobileMock: vi.fn(),
}));
vi.mock("@/lib/pfs-admin-api", () => ({
  pfsAdminFetchMaterialComposition: fetchMobileMock,
}));

import { preferMobileComposition } from "@/lib/pfs-verify-apply";

type CheckRefProduct = Parameters<typeof preferMobileComposition>[0];

const wholesalerCompo = () => [
  {
    id: "wh-cotton",
    reference: "COTTON",
    percentage: 100,
    labels: { fr: "Coton" },
  },
];

const mobileCompo = () => [
  {
    id: "mo-steel",
    reference: "ACIERINOXYDABLE",
    percentage: 100,
    labels: { fr: "Acier inoxydable" },
  },
];

const productWithWholesalerCompo = (): CheckRefProduct =>
  ({
    id: "pro_test_375",
    material_composition: wholesalerCompo(),
  } as unknown as CheckRefProduct);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("preferMobileComposition — mobile prioritaire", () => {
  it("écrase la compo wholesaler quand mobile renvoie une compo non vide (cas produit 375 Issyma)", async () => {
    fetchMobileMock.mockResolvedValueOnce(mobileCompo());
    const product = productWithWholesalerCompo();

    await preferMobileComposition(product, "REF-375");

    expect(fetchMobileMock).toHaveBeenCalledWith("pro_test_375");
    expect(product.material_composition).toEqual(mobileCompo());
  });

  it("garde la compo wholesaler quand mobile renvoie []", async () => {
    fetchMobileMock.mockResolvedValueOnce([]);
    const product = productWithWholesalerCompo();
    const before = product.material_composition;

    await preferMobileComposition(product, "REF-X");

    expect(fetchMobileMock).toHaveBeenCalled();
    expect(product.material_composition).toBe(before);
  });

  it("garde la compo wholesaler quand l'API admin est HS (throw)", async () => {
    fetchMobileMock.mockRejectedValueOnce(new Error("PFS Admin 503"));
    const product = productWithWholesalerCompo();
    const before = product.material_composition;

    await preferMobileComposition(product, "REF-Y");

    expect(product.material_composition).toBe(before);
  });

  it("ne fait aucun appel réseau si le produit n'a pas d'id PFS", async () => {
    const product = { id: "", material_composition: [] } as unknown as CheckRefProduct;

    await preferMobileComposition(product, "REF-Z");

    expect(fetchMobileMock).not.toHaveBeenCalled();
  });

  it("remplit une compo initialement vide quand mobile renvoie une compo (fallback historique)", async () => {
    fetchMobileMock.mockResolvedValueOnce(mobileCompo());
    const product = {
      id: "pro_test_empty",
      material_composition: [],
    } as unknown as CheckRefProduct;

    await preferMobileComposition(product, "REF-E");

    expect(product.material_composition).toEqual(mobileCompo());
  });
});
