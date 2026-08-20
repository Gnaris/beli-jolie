/**
 * Rename SKU côté Faire — fallback via matching de la valeur d'option `Color`.
 *
 * Cas couvert : le nouveau snapshot (calculé à partir de la BDD BJ) n'a pas
 * `faireVariantId` (ProductColor.faireVariantId = null, typiquement après une
 * liaison manuelle ancienne). Le snapshot précédent, lui, a l'ID Faire historique.
 * Sans fallback, le rename ne serait pas tenté et le diff DELETE+CREATE
 * casserait l'URL Faire. Le fix matche par colorOption pour retrouver l'ID.
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
  faireRenameVariantSkuSpy,
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
  prismaTransactionSpy: vi.fn().mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return ops.map(() => ({}));
    return ops;
  }),
  faireRenameVariantSkuSpy: vi.fn(),
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
vi.mock("@/lib/faire-rename-sku", () => ({
  faireRenameVariantSku: faireRenameVariantSkuSpy,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantIdSafe: vi.fn().mockResolvedValue(null),
  getTenantBaseUrl: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedFaireMadeInExcluded: vi.fn().mockResolvedValue([]),
}));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const HISTORIC_VID = "po_historic_variant";
const OLD_SKU = "A1720_BLEU";
const NEW_SKU = "A1721_BLEU";

function variantSnapshot(sku: string, faireVariantId: string | null) {
  return {
    sku,
    wholesalePriceCents: 500,
    retailPriceCents: 1500,
    availableQuantity: 10,
    active: true,
    colorOption: "Bleu",
    images: [],
    weightGrams: 25,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: null,
    faireVariantId,
  };
}

function prevSnapshot() {
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
    variants: {
      // Ancien snapshot : l'ID Faire historique EST connu ici.
      [OLD_SKU]: variantSnapshot(OLD_SKU, HISTORIC_VID),
    },
    lifecycleState: "PUBLISHED" as const,
  };
}

function nextSnapshot() {
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
    variants: {
      // Nouveau snapshot : ProductColor.faireVariantId = null en BDD → snapshot
      // ne connaît PAS l'ID Faire. C'est le cas de la liaison manuelle ancienne.
      [NEW_SKU]: variantSnapshot(NEW_SKU, null),
    },
    lifecycleState: "PUBLISHED" as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadMarkupSpy.mockResolvedValue({
    faireWholesale: { type: "percent", value: 0, rounding: "none" },
    faireRetail: { type: "multiplier", value: 3, rounding: "none" },
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
      name: "Bracelet",
      lifecycle_state: "PUBLISHED",
      variant_option_sets: [{ name: "Color", values: ["Bleu"] }],
      variants: [
        {
          sku: NEW_SKU,
          options: [{ name: "Color", value: "Bleu" }],
          active: true,
          available_quantity: 10,
        },
      ],
    },
    variants: [
      {
        bjVariantId: "v-bleu",
        sku: NEW_SKU,
        wholesalePriceCents: 500,
        retailPriceCents: 1500,
        payload: {
          sku: NEW_SKU,
          name: "Bleu",
          active: true,
          options: [{ name: "Color", value: "Bleu" }],
          prices: [],
          idempotence_token: NEW_SKU,
          available_quantity: 10,
        },
      },
    ],
    optionValues: ["Bleu"],
    productImagesCount: 0,
    productImageUrls: [],
  });
  buildFaireSnapshotSpy.mockReturnValue(nextSnapshot());

  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-a1721",
    status: "ONLINE",
    reference: "A1721",
    colors: [{ id: "v-bleu", faireVariantId: null, saleType: "UNIT" }],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-a1721",
    faireProductId: "fp-a1721",
    faireLastSyncSnapshot: prevSnapshot(),
  });

  faireUpdateInventorySpy.mockResolvedValue({
    success: true,
    updatedCount: 1,
    failedCount: 0,
    errors: [],
  });
  faireUpdatePricesSpy.mockResolvedValue({
    success: true,
    updatedCount: 1,
    failedCount: 0,
    errors: [],
  });

  faireRenameVariantSkuSpy.mockResolvedValue({ success: true });

  faireFetchSpy.mockImplementation(async (_url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [{ id: HISTORIC_VID, sku: NEW_SKU, images: [] }],
          images: [],
          variant_option_sets: [{ name: "Color", values: ["Bleu"] }],
        }),
      };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  });
});

describe("faireUpdateProduct — rename SKU fallback (colorOption match)", () => {
  it("retrouve l'ID Faire via matching colorOption quand next.faireVariantId est null", async () => {
    const res = await faireUpdateProduct("p-a1721");
    expect(res.success).toBe(true);

    // Le rename doit être tenté avec l'ID historique repêché depuis le prev
    // snapshot via matching colorOption "Bleu".
    expect(faireRenameVariantSkuSpy).toHaveBeenCalledTimes(1);
    expect(faireRenameVariantSkuSpy).toHaveBeenCalledWith(
      "fp-a1721",
      HISTORIC_VID,
      NEW_SKU,
    );

    // Aucun DELETE de variante ne doit être émis.
    const deleteCalls = faireFetchSpy.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        c[0].includes("/variants/") &&
        (c[1] as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(0);
  });
});
