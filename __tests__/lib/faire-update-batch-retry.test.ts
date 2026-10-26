/**
 * Régression 2026-10-26 : propagation lente de l'index by-skus côté Faire.
 *
 * Après un PATCH consolidé /products/{id}, Faire peut mettre quelques secondes
 * à indexer les SKU envoyés — pendant ce temps, /product-inventory/by-skus et
 * /product-prices/by-skus répondent 404 avec `message: <sku>`. Avant ce fix,
 * ce 404 transient était remonté à l'admin sous forme d'un message
 * « délier/relier » trompeur, même sur un simple refresh d'un produit déjà lié.
 *
 * Objectif : si l'erreur 404 est transient, les retries 3s puis 5s laissent
 * Faire rattraper son retard et la synchro se termine en succès.
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
    siteConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: (...a: unknown[]) => prismaTransactionSpy(...a),
  },
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantIdSafe: async () => "t-test",
  getTenantBaseUrl: async () => "https://example.com",
}));
vi.mock("@/lib/faire-api", () => ({ faireFetch: faireFetchSpy }));
vi.mock("@/lib/faire-inventory", () => ({
  faireUpdateInventory: faireUpdateInventorySpy,
}));
vi.mock("@/lib/faire-prices", () => ({ faireUpdatePrices: faireUpdatePricesSpy }));
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
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const SKU = "a86_dore_UNIT_vpoa4c6n";
const VID = "po_a86_dore";
const FAIRE_PRODUCT_ID = "p_a86";

function buildVariantSnapshot(availableQuantity = 100) {
  return {
    sku: SKU,
    wholesalePriceCents: 500,
    retailPriceCents: 1250,
    availableQuantity,
    active: true,
    colorOption: "Doré",
    images: ["https://example.com/a86-dore.jpg"],
    weightGrams: 15,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: null,
    faireVariantId: VID,
  };
}

function buildSnapshot(availableQuantity = 100) {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bague A86",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: { [SKU]: buildVariantSnapshot(availableQuantity) },
    lifecycleState: "PUBLISHED" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // setTimeout → immédiat pour ne pas attendre 8 s de backoff dans les tests.
  vi.spyOn(global, "setTimeout").mockImplementation(
    ((cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  );

  loadMarkupSpy.mockResolvedValue({
    faireWholesale: { type: "percent", value: 0, rounding: "none" },
    faireRetail: { type: "multiplier", value: 2.5, rounding: "none" },
  });
  buildPublishContextSpy.mockReturnValue({
    ok: true,
    ctx: {
      taxonomyTypeId: "tt_x",
      tariffCode: null,
      countryAlpha2: "CN",
      description: "long",
      countryUsedFallback: false,
    },
  });
  buildFaireProductPayloadSpy.mockReturnValue({
    body: {
      name: "Bague A86",
      lifecycle_state: "PUBLISHED",
      images: [{ url: "https://example.com/a86-dore.jpg?format=jpeg&minWidth=1000" }],
    },
    variants: [
      {
        bjVariantId: "v-dore",
        sku: SKU,
        wholesalePriceCents: 500,
        retailPriceCents: 1250,
        payload: {
          sku: SKU,
          name: "Doré",
          active: true,
          options: [{ name: "Color", value: "Doré" }],
          prices: [],
          idempotence_token: SKU,
          available_quantity: 100,
        },
      },
    ],
    optionValues: ["Doré"],
    productImagesCount: 1,
    productImageUrls: ["https://example.com/a86-dore.jpg"],
  });

  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-a86",
    status: "ONLINE",
    colors: [{ id: "v-dore", faireVariantId: VID, saleType: "UNIT" }],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-a86",
    faireProductId: FAIRE_PRODUCT_ID,
    // Snapshot précédent : stock 50 → stock cible 100 déclenche un
    // inventoryOnlyChanged, ce qui active l'appel /product-inventory/by-skus.
    faireLastSyncSnapshot: buildSnapshot(50),
  });
  buildFaireSnapshotSpy.mockReturnValue(buildSnapshot(100));

  // PATCH /products/{id} et toute autre requête Faire renvoient 200 OK.
  faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === `/products/${FAIRE_PRODUCT_ID}`) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [{ id: VID, sku: SKU, images: [] }],
          images: [],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ variants: [{ id: VID, sku: SKU }] }),
    };
  });

  faireUpdatePricesSpy.mockResolvedValue({
    success: true,
    updatedCount: 1,
    failedCount: 0,
    errors: [],
  });
});

describe("faireUpdateProduct — retry inventory 404 unknownSku", () => {
  it("réussit si Faire renvoie 404 unknownSku puis 200 (propagation ~3 s)", async () => {
    faireUpdateInventorySpy
      .mockResolvedValueOnce({
        success: false,
        updatedCount: 0,
        failedCount: 1,
        errors: [{ sku: SKU, message: "HTTP 404" }],
        unknownSku: SKU,
      })
      .mockResolvedValueOnce({
        success: true,
        updatedCount: 1,
        failedCount: 0,
        errors: [],
      });

    const res = await faireUpdateProduct("p-a86");

    expect(res.success).toBe(true);
    expect(faireUpdateInventorySpy).toHaveBeenCalledTimes(2);
  });

  it("réussit si Faire renvoie 404 unknownSku deux fois puis 200 (propagation ~8 s)", async () => {
    faireUpdateInventorySpy
      .mockResolvedValueOnce({
        success: false,
        updatedCount: 0,
        failedCount: 1,
        errors: [{ sku: SKU, message: "HTTP 404" }],
        unknownSku: SKU,
      })
      .mockResolvedValueOnce({
        success: false,
        updatedCount: 0,
        failedCount: 1,
        errors: [{ sku: SKU, message: "HTTP 404" }],
        unknownSku: SKU,
      })
      .mockResolvedValueOnce({
        success: true,
        updatedCount: 1,
        failedCount: 0,
        errors: [],
      });

    const res = await faireUpdateProduct("p-a86");

    expect(res.success).toBe(true);
    expect(faireUpdateInventorySpy).toHaveBeenCalledTimes(3);
  });

  it("surface « délier/relier » si Faire persiste à renvoyer 404 unknownSku après tous les retries", async () => {
    faireUpdateInventorySpy.mockResolvedValue({
      success: false,
      updatedCount: 0,
      failedCount: 1,
      errors: [{ sku: SKU, message: "HTTP 404" }],
      unknownSku: SKU,
    });

    const res = await faireUpdateProduct("p-a86");

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain(SKU);
      expect(res.error).toContain("délier");
    }
    expect(faireUpdateInventorySpy).toHaveBeenCalledTimes(3);
  });
});

describe("faireUpdateProduct — retry prices 404 unknownSku", () => {
  beforeEach(() => {
    // Pour isoler le flow prix : snapshot précédent stock identique (pas
    // d'inventory update) mais prix différent (déclenche pricesOnlyChanged).
    prismaFindUniqueSpy.mockResolvedValue({
      id: "p-a86",
      faireProductId: FAIRE_PRODUCT_ID,
      faireLastSyncSnapshot: {
        ...buildSnapshot(100),
        variants: {
          [SKU]: { ...buildVariantSnapshot(100), wholesalePriceCents: 400 },
        },
      },
    });
    buildFaireSnapshotSpy.mockReturnValue(buildSnapshot(100));
    faireUpdateInventorySpy.mockResolvedValue({
      success: true,
      updatedCount: 0,
      failedCount: 0,
      errors: [],
    });
  });

  it("réussit si Faire renvoie 404 unknownSku sur les prix puis 200", async () => {
    faireUpdatePricesSpy
      .mockResolvedValueOnce({
        success: false,
        updatedCount: 0,
        failedCount: 1,
        errors: [{ sku: SKU, message: "HTTP 404" }],
        unknownSku: SKU,
      })
      .mockResolvedValueOnce({
        success: true,
        updatedCount: 1,
        failedCount: 0,
        errors: [],
      });

    const res = await faireUpdateProduct("p-a86");

    expect(res.success).toBe(true);
    expect(faireUpdatePricesSpy).toHaveBeenCalledTimes(2);
  });
});
