/**
 * Garantit que `faireUpdateProduct(..., { forceFullSync: true })` :
 *   1. ne court-circuite PAS sur un diff vide (cas typique : on a déjà sync,
 *      le snapshot DB matche l'état BJ → en mode nominal, rien à pousser) ;
 *   2. pousse les prix de TOUTES les variantes liées via
 *      `/product-prices/by-skus` (le PATCH variant ignore silencieusement
 *      les prix — bug Faire) ;
 *   3. pousse le stock de TOUTES les variantes liées via
 *      `/product-inventory/by-skus`.
 *
 * Régression : avant la correction, le bouton « Re-synchroniser sur Faire »
 * appelait faireUpdateProduct sans option → diff vide → ni les prix ni le
 * stock n'étaient renvoyés vers Faire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  faireFetchSpy,
  faireUpdateInventorySpy,
  faireUpdatePricesSpy,
  loadMarkupSpy,
  loadFaireProductFullSpy,
  buildPublishContextSpy,
  buildFaireProductPayloadSpy,
  buildFaireSnapshotSpy,
  prismaFindUniqueSpy,
  prismaProductUpdateSpy,
  prismaProductColorUpdateSpy,
  prismaTransactionSpy,
} = vi.hoisted(() => ({
  faireFetchSpy: vi.fn(),
  faireUpdateInventorySpy: vi.fn(),
  faireUpdatePricesSpy: vi.fn(),
  loadMarkupSpy: vi.fn(),
  loadFaireProductFullSpy: vi.fn(),
  buildPublishContextSpy: vi.fn(),
  buildFaireProductPayloadSpy: vi.fn(),
  buildFaireSnapshotSpy: vi.fn(),
  prismaFindUniqueSpy: vi.fn(),
  prismaProductUpdateSpy: vi.fn().mockResolvedValue({}),
  prismaProductColorUpdateSpy: vi.fn().mockResolvedValue({}),
  prismaTransactionSpy: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => prismaFindUniqueSpy(...a),
      update: (...a: unknown[]) => prismaProductUpdateSpy(...a),
    },
    productColor: {
      update: (...a: unknown[]) => prismaProductColorUpdateSpy(...a),
    },
    $transaction: (...a: unknown[]) => prismaTransactionSpy(...a),
  },
}));
vi.mock("@/lib/faire-api", () => ({
  faireFetch: faireFetchSpy,
}));
vi.mock("@/lib/faire-inventory", () => ({
  faireUpdateInventory: faireUpdateInventorySpy,
}));
vi.mock("@/lib/faire-prices", () => ({
  faireUpdatePrices: faireUpdatePricesSpy,
}));
vi.mock("@/lib/marketplace-pricing", () => ({
  loadMarketplaceMarkupConfigs: loadMarkupSpy,
}));
vi.mock("@/lib/faire-publish", () => ({
  loadFaireProductFull: loadFaireProductFullSpy,
  buildPublishContext: buildPublishContextSpy,
  buildFaireProductPayload: buildFaireProductPayloadSpy,
  buildFaireSnapshot: buildFaireSnapshotSpy,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const VARIANT_SKUS = ["BJ-OR", "BJ-ARG"];

function buildVariantSnapshot(sku: string) {
  return {
    sku,
    wholesalePriceCents: 800,
    retailPriceCents: 2000,
    availableQuantity: 5,
    active: true,
    colorOption: sku === "BJ-OR" ? "Or" : "Argent",
    images: [],
    weightGrams: 20,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: "7117.19.00",
    faireVariantId: `po_${sku}`,
  };
}

function buildSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: Object.fromEntries(
      VARIANT_SKUS.map((sku) => [sku, buildVariantSnapshot(sku)]),
    ),
    lifecycleState: "PUBLISHED" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMarkupSpy.mockResolvedValue({
    faireWholesale: { type: "percent", value: 0, rounding: "none" },
    faireRetail: { type: "multiplier", value: 2.5, rounding: "none" },
  });
  buildPublishContextSpy.mockReturnValue({
    ok: true,
    ctx: {
      taxonomyTypeId: "tt_x",
      tariffCode: "7117.19.00",
      countryAlpha2: "CN",
      description: "long",
      countryUsedFallback: false,
    },
  });
  buildFaireProductPayloadSpy.mockReturnValue({
    body: { name: "Bracelet", lifecycle_state: "PUBLISHED" },
    variants: VARIANT_SKUS.map((sku) => ({
      bjVariantId: `v-${sku}`,
      sku,
      wholesalePriceCents: 800,
      retailPriceCents: 2000,
      payload: {
        sku,
        name: sku === "BJ-OR" ? "Or" : "Argent",
        active: true,
        options: [{ name: "Color", value: sku === "BJ-OR" ? "Or" : "Argent" }],
        prices: [],
        idempotence_token: sku,
        available_quantity: 5,
      },
    })),
    optionValues: ["Or", "Argent"],
    productImagesCount: 0,
    productImageUrls: [],
  });
  buildFaireSnapshotSpy.mockReturnValue(buildSnapshot());

  // Produit BJ avec 2 couleurs déjà liées à des variantes Faire (faireVariantId).
  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-1",
    status: "ONLINE",
    colors: VARIANT_SKUS.map((sku) => ({
      id: `v-${sku}`,
      faireVariantId: `po_${sku}`,
      saleType: "UNIT",
    })),
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-1",
    faireProductId: "fp-1",
    faireLastSyncSnapshot: buildSnapshot(),
  });

  faireFetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ variants: [] }),
  });
  faireUpdateInventorySpy.mockResolvedValue({
    success: true,
    updatedCount: VARIANT_SKUS.length,
    failedCount: 0,
    errors: [],
  });
  faireUpdatePricesSpy.mockResolvedValue({
    success: true,
    updatedCount: VARIANT_SKUS.length,
    failedCount: 0,
    errors: [],
  });
});

describe("faireUpdateProduct — forceFullSync", () => {
  it("sans forceFullSync : si le snapshot DB matche l'état cible, ni les prix ni le stock ne partent vers Faire", async () => {
    const res = await faireUpdateProduct("p-1");

    expect(res.success).toBe(true);
    if (res.success) expect(res.noop).toBe(true);
    expect(faireUpdatePricesSpy).not.toHaveBeenCalled();
    expect(faireUpdateInventorySpy).not.toHaveBeenCalled();
  });

  it("avec forceFullSync=true : pousse les prix de TOUTES les variantes liées via /product-prices/by-skus", async () => {
    const res = await faireUpdateProduct("p-1", { forceFullSync: true });

    expect(res.success).toBe(true);
    expect(faireUpdatePricesSpy).toHaveBeenCalledTimes(1);
    const updates = faireUpdatePricesSpy.mock.calls[0][0] as {
      sku: string;
      wholesaleCents: number;
      retailCents: number;
    }[];
    expect(updates.map((u) => u.sku).sort()).toEqual([...VARIANT_SKUS].sort());
    expect(updates.every((u) => u.wholesaleCents === 800 && u.retailCents === 2000)).toBe(true);
  });

  it("avec forceFullSync=true : pousse le stock de TOUTES les variantes liées via /product-inventory/by-skus", async () => {
    const res = await faireUpdateProduct("p-1", { forceFullSync: true });

    expect(res.success).toBe(true);
    expect(faireUpdateInventorySpy).toHaveBeenCalledTimes(1);
    const updates = faireUpdateInventorySpy.mock.calls[0][0] as {
      sku: string;
      currentQuantity: number;
    }[];
    expect(updates.map((u) => u.sku).sort()).toEqual([...VARIANT_SKUS].sort());
  });
});
