/**
 * Régression 2026-07-27 : quand la purge amont (bloc 3.ter) rate un vid
 * stale — parce que le GET produit retournait encore la variante au moment
 * du check, ou parce que Faire l'a supprimée en réponse au PATCH product
 * qu'on vient d'envoyer — le PATCH variant individuel qui suit renvoie
 * HTTP 404. Cas vu en prod sur A71/Écru (vid `po_fybfszy8xw`).
 *
 * Correctif : dans la boucle PATCH variant, un 404 ne casse plus tout le
 * flow. On :
 *   1. logge un warning,
 *   2. clear `faireVariantId` en BDD pour cette couleur,
 *   3. exclut le sku des updates stock / prix qui suivent,
 *   4. laisse `faireSyncRequired = true` (le badge « Synchro nécessaire »
 *      reste affiché — un clic « Rafraîchir Faire » de plus recréera la
 *      variante via le PATCH consolidé).
 *
 * Le flow doit rendre `{ success: true }` pour ne pas bloquer les autres
 * mutations (les 3 autres variantes ont bien été patchées).
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
  prismaTransactionSpy: vi.fn().mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return ops.map(() => ({}));
    return ops;
  }),
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
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const OK_SKU = "a71_bleu_UNIT_ytvshfoe";
const GHOST_SKU = "a71_ecru_UNIT_zymotpd3";
const OK_VID = "po_jq8tsfbbwa";
const GHOST_VID = "po_fybfszy8xw"; // BDD dit qu'il existe, Faire répond 404 au PATCH.
const BJ_GHOST_VARIANT_ID = "v-ecru";

function buildVariantSnapshot(sku: string, colorOption: string, faireVariantId: string | null) {
  return {
    sku,
    wholesalePriceCents: 250,
    retailPriceCents: 625,
    availableQuantity: 100,
    active: true,
    colorOption,
    images: [`https://example.com/${sku}.jpg`],
    weightGrams: 20,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: null,
    faireVariantId,
  };
}

function buildSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet A71",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: {
      // Snapshot précédent : nom court "Bracelet". Le next a "Bracelet A71" →
      // productChanged + variantsChanged (name des 2 variantes).
      [OK_SKU]: buildVariantSnapshot(OK_SKU, "Bleu", OK_VID),
      [GHOST_SKU]: buildVariantSnapshot(GHOST_SKU, "Écru", GHOST_VID),
    },
    lifecycleState: "PUBLISHED" as const,
  };
}

function buildPrevSnapshot() {
  const s = buildSnapshot();
  s.product.name = "Bracelet";
  s.variants[OK_SKU].colorOption = "Bleu foncé";
  s.variants[GHOST_SKU].colorOption = "Ecru";
  return s;
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
      tariffCode: null,
      countryAlpha2: "CN",
      description: "long",
      countryUsedFallback: false,
    },
  });
  buildFaireProductPayloadSpy.mockReturnValue({
    body: {
      name: "Bracelet A71",
      lifecycle_state: "PUBLISHED",
      variant_option_sets: [{ name: "Color", values: ["Bleu", "Écru"] }],
      variants: [
        {
          id: OK_VID,
          sku: OK_SKU,
          options: [{ name: "Color", value: "Bleu" }],
          active: true,
          available_quantity: 100,
        },
        {
          id: GHOST_VID,
          sku: GHOST_SKU,
          options: [{ name: "Color", value: "Écru" }],
          active: true,
          available_quantity: 100,
        },
      ],
    },
    variants: [
      {
        bjVariantId: "v-bleu",
        sku: OK_SKU,
        wholesalePriceCents: 250,
        retailPriceCents: 625,
        payload: {
          sku: OK_SKU,
          name: "Bleu",
          active: true,
          options: [{ name: "Color", value: "Bleu" }],
          prices: [],
          idempotence_token: OK_SKU,
          available_quantity: 100,
        },
      },
      {
        bjVariantId: BJ_GHOST_VARIANT_ID,
        sku: GHOST_SKU,
        wholesalePriceCents: 250,
        retailPriceCents: 625,
        payload: {
          sku: GHOST_SKU,
          name: "Écru",
          active: true,
          options: [{ name: "Color", value: "Écru" }],
          prices: [],
          idempotence_token: GHOST_SKU,
          available_quantity: 100,
        },
      },
    ],
    optionValues: ["Bleu", "Écru"],
    productImagesCount: 0,
    productImageUrls: [],
  });
  buildFaireSnapshotSpy.mockReturnValue(buildSnapshot());

  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-a71",
    status: "ONLINE",
    colors: [
      { id: "v-bleu", faireVariantId: OK_VID, saleType: "UNIT" },
      { id: BJ_GHOST_VARIANT_ID, faireVariantId: GHOST_VID, saleType: "UNIT" },
    ],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-a71",
    faireProductId: "fp-a71",
    faireLastSyncSnapshot: buildPrevSnapshot(),
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

  // Faire GET répond avec les 2 vids (donc bloc 3.ter ne purge PAS le GHOST_VID).
  // PATCH product OK. PATCH variant OK sur OK_VID, 404 sur GHOST_VID.
  faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/products/fp-a71") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            { id: OK_VID, sku: OK_SKU, images: [] },
            { id: GHOST_VID, sku: GHOST_SKU, images: [] },
          ],
          images: [],
        }),
      };
    }
    if (method === "PATCH" && url === "/products/fp-a71") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            { id: OK_VID, sku: OK_SKU },
            { id: GHOST_VID, sku: GHOST_SKU },
          ],
        }),
      };
    }
    if (
      method === "PATCH" &&
      url === `/products/fp-a71/variants/${encodeURIComponent(GHOST_VID)}`
    ) {
      return {
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({
            status_code: 404,
            status_type: "Not Found",
            message: GHOST_VID,
            entity_tokens: [],
          }),
        json: async () => ({}),
      };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  });
});

describe("faireUpdateProduct — PATCH variant 404 = variante fantôme", () => {
  it("ne casse pas la synchro et renvoie success", async () => {
    const res = await faireUpdateProduct("p-a71");
    expect(res.success).toBe(true);
  });

  it("clear le faireVariantId de la variante fantôme en BDD", async () => {
    await faireUpdateProduct("p-a71");
    const clear = prismaProductColorUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as {
        where?: { id?: string };
        data?: { faireVariantId?: string | null };
      };
      return (
        args?.where?.id === BJ_GHOST_VARIANT_ID &&
        args?.data?.faireVariantId === null
      );
    });
    expect(clear, "productColor.update(vid → null) doit être appelé pour la variante fantôme").toBeTruthy();
  });

  it("laisse faireSyncRequired = true (ne le reset pas)", async () => {
    await faireUpdateProduct("p-a71");
    // Le save final doit toucher seulement faireLastSyncSnapshot, pas
    // faireSyncRequired — sinon le badge orange disparaît alors qu'il reste
    // une variante à recréer.
    const finalSave = prismaProductUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as {
        where?: { id?: string };
        data?: Record<string, unknown>;
      };
      return args?.where?.id === "p-a71" && "faireLastSyncSnapshot" in (args?.data ?? {});
    });
    expect(finalSave, "product.update final avec le snapshot doit exister").toBeTruthy();
    const data = (finalSave![0] as { data: Record<string, unknown> }).data;
    expect(data.faireSyncRequired).toBeUndefined();
  });

  it("n'envoie ni stock ni prix pour le sku fantôme", async () => {
    await faireUpdateProduct("p-a71");
    const inventoryCall = faireUpdateInventorySpy.mock.calls[0]?.[0] as
      | { sku: string }[]
      | undefined;
    const inventorySkus = inventoryCall?.map((u) => u.sku) ?? [];
    expect(inventorySkus).not.toContain(GHOST_SKU);

    const priceCall = faireUpdatePricesSpy.mock.calls[0]?.[0] as
      | { sku: string }[]
      | undefined;
    const priceSkus = priceCall?.map((u) => u.sku) ?? [];
    expect(priceSkus).not.toContain(GHOST_SKU);
  });
});
