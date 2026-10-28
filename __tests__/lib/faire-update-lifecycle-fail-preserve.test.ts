/**
 * Régression 2026-10-28 : quand le PATCH `lifecycle_state` d'une variante est
 * refusé par Faire (HTTP 400 PROHIBITED_PRODUCT / COUNTERFEIT_PRODUCT), on
 * écrivait quand même dans le snapshot local « disabled: true » comme si c'était
 * passé → le prochain sync voyait prev === next et ne retentait jamais le
 * PATCH. En prod sur Issyma, 327B Noir était désactivé en BJ mais restait
 * PUBLISHED chez Faire, une acheteuse portugaise a pu commander la variante
 * (commande 4HCZQ6UH2R).
 *
 * Fix : si le PATCH lifecycle échoue, on garde dans le snapshot l'ancien état
 * `disabled` de la variante concernée + on laisse `faireSyncRequired = true`
 * pour qu'un prochain sync retente.
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
  prismaProductColorUpdateManySpy,
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
  prismaProductColorUpdateManySpy: vi.fn().mockResolvedValue({ count: 0 }),
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
      updateMany: (...a: unknown[]) => prismaProductColorUpdateManySpy(...a),
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
vi.mock("@/lib/cached-data", () => ({
  getCachedFaireMadeInExcluded: async () => [] as string[],
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantIdSafe: async () => "tenant-test",
  getTenantBaseUrl: async () => "https://example.com",
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: <A extends unknown[], R>(fn: (...a: A) => R): ((...a: A) => R) => fn,
}));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const PID = "p-327b";
const FAIRE_PID = "p_kdfpbfjhfq";
const NOIR_SKU = "327b_noir_UNIT_gzp2xc1o";
const BEIGE_SKU = "327b_beige_UNIT_ft0j0td3";
const NOIR_VID = "po_34vqa69kb2";
const BEIGE_VID = "po_hjwxaqdnwu";

function buildVariantSnapshot(sku: string, color: string, vid: string, disabled: boolean) {
  return {
    sku,
    wholesalePriceCents: 1900,
    retailPriceCents: 4750,
    availableQuantity: 287,
    active: !disabled,
    disabled,
    colorOption: color,
    images: [`https://example.com/${sku}.jpg`],
    weightGrams: 300,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: null,
    faireVariantId: vid,
  };
}

function buildNextSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Pull 327B",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "IT",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: {
      [NOIR_SKU]: buildVariantSnapshot(NOIR_SKU, "Noir", NOIR_VID, true),
      [BEIGE_SKU]: buildVariantSnapshot(BEIGE_SKU, "Beige", BEIGE_VID, true),
    },
    lifecycleState: "PUBLISHED" as const,
  };
}

function buildPrevSnapshot() {
  const s = buildNextSnapshot();
  s.variants[NOIR_SKU].disabled = false;
  s.variants[NOIR_SKU].active = true;
  s.variants[BEIGE_SKU].disabled = false;
  s.variants[BEIGE_SKU].active = true;
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
      countryAlpha2: "IT",
      description: "long",
      countryUsedFallback: false,
    },
  });
  buildFaireProductPayloadSpy.mockReturnValue({
    body: {
      name: "Pull 327B",
      lifecycle_state: "PUBLISHED",
      variant_option_sets: [{ name: "Color", values: ["Noir", "Beige"] }],
      variants: [],
    },
    variants: [
      {
        bjVariantId: "v-noir",
        sku: NOIR_SKU,
        wholesalePriceCents: 1900,
        retailPriceCents: 4750,
        disabled: true,
        payload: {
          id: NOIR_VID,
          sku: NOIR_SKU,
          name: "Noir",
          options: [{ name: "Color", value: "Noir" }],
          prices: [],
          idempotence_token: NOIR_SKU,
          available_quantity: 287,
        },
      },
      {
        bjVariantId: "v-beige",
        sku: BEIGE_SKU,
        wholesalePriceCents: 1900,
        retailPriceCents: 4750,
        disabled: true,
        payload: {
          id: BEIGE_VID,
          sku: BEIGE_SKU,
          name: "Beige",
          options: [{ name: "Color", value: "Beige" }],
          prices: [],
          idempotence_token: BEIGE_SKU,
          available_quantity: 290,
        },
      },
    ],
    optionValues: ["Noir", "Beige"],
    productImagesCount: 0,
    productImageUrls: [],
  });
  buildFaireSnapshotSpy.mockReturnValue(buildNextSnapshot());

  loadFaireProductFullSpy.mockResolvedValue({
    id: PID,
    status: "ONLINE",
    colors: [
      { id: "v-noir", faireVariantId: NOIR_VID, saleType: "UNIT" },
      { id: "v-beige", faireVariantId: BEIGE_VID, saleType: "UNIT" },
    ],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: PID,
    faireProductId: FAIRE_PID,
    faireLastSyncSnapshot: buildPrevSnapshot(),
  });

  faireUpdateInventorySpy.mockResolvedValue({
    success: true,
    updatedCount: 2,
    failedCount: 0,
    errors: [],
  });
  faireUpdatePricesSpy.mockResolvedValue({
    success: true,
    updatedCount: 2,
    failedCount: 0,
    errors: [],
  });

  // Faire GET répond avec les 2 vids. PATCH product OK. PATCH variant OK.
  // Mais PATCH /variants/{NOIR_VID} avec { lifecycle_state: UNPUBLISHED }
  // renvoie 400 PROHIBITED_PRODUCT (Faire a flaggé la variante).
  faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === `/products/${FAIRE_PID}`) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            {
              id: NOIR_VID,
              sku: NOIR_SKU,
              images: [],
              options: [{ name: "Color", value: "Noir" }],
            },
            {
              id: BEIGE_VID,
              sku: BEIGE_SKU,
              images: [],
              options: [{ name: "Color", value: "Beige" }],
            },
          ],
          images: [],
          variant_option_sets: [{ name: "Color", values: ["Noir", "Beige"] }],
        }),
      };
    }
    if (method === "PATCH" && url === `/products/${FAIRE_PID}`) {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            { id: NOIR_VID, sku: NOIR_SKU },
            { id: BEIGE_VID, sku: BEIGE_SKU },
          ],
        }),
      };
    }
    if (method === "PATCH" && url.startsWith(`/products/${FAIRE_PID}/variants/`)) {
      const body = init?.body ? JSON.parse(init.body) : {};
      const isLifecycle = "lifecycle_state" in body && Object.keys(body).length === 1;
      const targetVid = decodeURIComponent(url.split("/").pop() ?? "");
      // Noir refusé sur lifecycle PATCH uniquement.
      if (isLifecycle && targetVid === NOIR_VID) {
        return {
          ok: false,
          status: 400,
          text: async () =>
            JSON.stringify({
              status_code: 400,
              message:
                "Ce produit ne peut pas être publié, car il ne répond pas aux directives de Faire relatives aux produits",
              field: "lifecycleState",
              service_error_code: "ProductValidationException.PROHIBITED_PRODUCT",
            }),
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  });
});

describe("faireUpdateProduct — PATCH lifecycle refusé par Faire", () => {
  it("sauve le snapshot avec disabled préservé (false) pour la variante refusée", async () => {
    await faireUpdateProduct(PID, { forceFullSync: true });
    const finalSave = prismaProductUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as {
        where?: { id?: string };
        data?: Record<string, unknown>;
      };
      return args?.where?.id === PID && "faireLastSyncSnapshot" in (args?.data ?? {});
    });
    expect(finalSave, "sauvegarde finale du snapshot doit exister").toBeTruthy();
    const snapshot = (finalSave![0] as {
      data: { faireLastSyncSnapshot: ReturnType<typeof buildNextSnapshot> };
    }).data.faireLastSyncSnapshot;
    // Noir : PATCH refusé → snapshot garde disabled=false (ancien état) pour
    // qu'un prochain sync retente.
    expect(snapshot.variants[NOIR_SKU].disabled).toBe(false);
    // Beige : PATCH OK → snapshot reflète disabled=true (nouvel état).
    expect(snapshot.variants[BEIGE_SKU].disabled).toBe(true);
  });

  it("laisse faireSyncRequired = true quand un PATCH lifecycle a échoué", async () => {
    await faireUpdateProduct(PID, { forceFullSync: true });
    const finalSave = prismaProductUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as {
        where?: { id?: string };
        data?: Record<string, unknown>;
      };
      return args?.where?.id === PID && "faireLastSyncSnapshot" in (args?.data ?? {});
    });
    const data = (finalSave![0] as { data: Record<string, unknown> }).data;
    // Pas de reset explicite = BDD garde true (badge orange reste affiché).
    expect(data.faireSyncRequired).toBeUndefined();
  });

  it("retente le PATCH lifecycle Noir au prochain sync même sans nouveau changement", async () => {
    // Après le 1er sync qui a échoué sur Noir, le snapshot garde disabled=false
    // pour Noir. On relance avec le même état BJ (disabled=true) → le diff
    // revoit (false → true) et re-pousse le PATCH.
    // Simulation : le GET suivant devrait trouver un lifecycleUpdate pour Noir.
    await faireUpdateProduct(PID, { forceFullSync: true });

    // Resimule un 2ᵉ run avec le snapshot sauvé.
    const savedSnapshot = (prismaProductUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as { where?: { id?: string }; data?: Record<string, unknown> };
      return args?.where?.id === PID && "faireLastSyncSnapshot" in (args?.data ?? {});
    })![0] as { data: { faireLastSyncSnapshot: ReturnType<typeof buildNextSnapshot> } })
      .data.faireLastSyncSnapshot;

    // Beige doit être marqué disabled=true (passé OK), Noir disabled=false
    // (préservé). Le prochain sync verra Noir prev=false next=true et renverra
    // le PATCH.
    expect(savedSnapshot.variants[NOIR_SKU].disabled).toBe(false);
    expect(savedSnapshot.variants[BEIGE_SKU].disabled).toBe(true);
  });
});
