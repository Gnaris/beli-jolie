/**
 * Régression 2026-07 : quand une variante BJ garde en BDD un `faireVariantId`
 * qui n'existe plus côté Faire (variante supprimée par un flow antérieur,
 * renommage de couleur ayant provoqué DELETE + non-recréation, ou action
 * manuelle sur le portail), le PATCH sur ce vid renvoyait HTTP 404 et faisait
 * échouer toute la synchro à chaque tentative — sans jamais se guérir.
 *
 * Correctif : au début du flow, on GET l'état Faire du produit et on purge
 * les vids stales (BDD + Map interne). La variante bascule automatiquement
 * dans `newVariantsToCreate` et est recréée via le PATCH consolidé.
 *
 * Cas testé : W138 avec 2 variantes UNIT, dont la 2ᵉ a un vid stale.
 *   - Le vid stale doit être clear en BDD.
 *   - Le PATCH consolidé doit inclure `variants[]` avec la variante à recréer.
 *   - Le nouveau vid Faire renvoyé dans la réponse doit être persisté.
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
    // Simule un $transaction qui exécute les updates BDD.
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

const OK_SKU = "w138_blanc_UNIT_zrr1jlrd";
const STALE_SKU = "w138_ecru_UNIT_rvm1o0n8";
const OK_VID = "po_ok_valid";
const STALE_VID = "po_grj7cer22b"; // Connu de la BDD BJ, inconnu de Faire.
const RECREATED_VID = "po_recreated_ecru";
const BJ_STALE_VARIANT_ID = "v-ecru";

function buildVariantSnapshot(sku: string, colorOption: string, faireVariantId: string | null) {
  return {
    sku,
    wholesalePriceCents: 390,
    retailPriceCents: 970,
    availableQuantity: 1000,
    active: true,
    colorOption,
    images: [`https://example.com/${sku}.jpg`],
    weightGrams: 25,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: null,
    faireVariantId,
  };
}

// Snapshot précédent : uniquement la variante OK (l'Écru vient d'être ajoutée
// depuis, ou son SKU vient de changer → la BDD garde le vieux vid orphelin).
function buildPrevSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet jonc en laiton",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: {
      [OK_SKU]: buildVariantSnapshot(OK_SKU, "Blanc", OK_VID),
    },
    lifecycleState: "PUBLISHED" as const,
  };
}

function buildNextSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet jonc en laiton",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: {
      [OK_SKU]: buildVariantSnapshot(OK_SKU, "Blanc", OK_VID),
      [STALE_SKU]: buildVariantSnapshot(STALE_SKU, "Écru", STALE_VID),
    },
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
      tariffCode: null,
      countryAlpha2: "CN",
      description: "long",
      countryUsedFallback: false,
    },
  });
  buildFaireProductPayloadSpy.mockReturnValue({
    body: {
      name: "Bracelet jonc en laiton",
      lifecycle_state: "PUBLISHED",
      variant_option_sets: [{ name: "Color", values: ["Blanc", "Écru"] }],
      variants: [
        {
          id: OK_VID,
          sku: OK_SKU,
          options: [{ name: "Color", value: "Blanc" }],
          active: true,
          available_quantity: 1000,
        },
        {
          // buildFaireProductPayload s'exécute AVANT la réconciliation et
          // pose le `id` stale sur la variante Écru (car `bjVariant.faireVariantId
          // = STALE_VID` en BDD). Le flow doit stripper ce `id` avant PATCH.
          id: STALE_VID,
          sku: STALE_SKU,
          options: [{ name: "Color", value: "Écru" }],
          active: true,
          available_quantity: 1000,
        },
      ],
    },
    variants: [
      {
        bjVariantId: "v-blanc",
        sku: OK_SKU,
        wholesalePriceCents: 390,
        retailPriceCents: 970,
        payload: {
          sku: OK_SKU,
          name: "Blanc",
          active: true,
          options: [{ name: "Color", value: "Blanc" }],
          prices: [],
          idempotence_token: OK_SKU,
          available_quantity: 1000,
        },
      },
      {
        bjVariantId: BJ_STALE_VARIANT_ID,
        sku: STALE_SKU,
        wholesalePriceCents: 390,
        retailPriceCents: 970,
        payload: {
          sku: STALE_SKU,
          name: "Écru",
          active: true,
          options: [{ name: "Color", value: "Écru" }],
          prices: [],
          idempotence_token: STALE_SKU,
          available_quantity: 1000,
        },
      },
    ],
    optionValues: ["Blanc", "Écru"],
    productImagesCount: 0,
    productImageUrls: [],
  });
  buildFaireSnapshotSpy.mockReturnValue(buildNextSnapshot());

  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-w138",
    status: "ONLINE",
    colors: [
      { id: "v-blanc", faireVariantId: OK_VID, saleType: "UNIT" },
      { id: BJ_STALE_VARIANT_ID, faireVariantId: STALE_VID, saleType: "UNIT" },
    ],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-w138",
    faireProductId: "fp-w138",
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

  // Faire GET répond avec UNIQUEMENT la variante Blanc (vid Écru absent) →
  // déclenche la réconciliation. Le PATCH consolidé répond avec les 2
  // variantes, dont la nouvelle Écru avec son nouveau vid.
  faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            { id: OK_VID, sku: OK_SKU, images: [] },
            // STALE_VID volontairement absent.
          ],
          images: [],
        }),
      };
    }
    if (method === "PATCH" && url === "/products/fp-w138") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            { id: OK_VID, sku: OK_SKU },
            { id: RECREATED_VID, sku: STALE_SKU },
          ],
        }),
      };
    }
    // PATCH variant / DELETE / autres : réponses génériques OK.
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  });
});

describe("faireUpdateProduct — réconciliation vids stales", () => {
  it("purge les faireVariantId stales de la BDD avant le PATCH consolidé", async () => {
    await faireUpdateProduct("p-w138");

    const stalePurge = prismaProductColorUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as { where?: { id?: string }; data?: { faireVariantId?: string | null } };
      return (
        args?.where?.id === BJ_STALE_VARIANT_ID &&
        args?.data?.faireVariantId === null
      );
    });
    expect(stalePurge, "productColor.update(vid → null) doit être appelé pour la variante stale").toBeTruthy();
  });

  it("recrée la variante stale via PATCH consolidé (variants[] + variant_option_sets)", async () => {
    const res = await faireUpdateProduct("p-w138");
    expect(res.success).toBe(true);

    const consolidatedPatch = faireFetchSpy.mock.calls.find(([url, init]) => {
      const method = (init as { method?: string } | undefined)?.method ?? "GET";
      return url === "/products/fp-w138" && method === "PATCH";
    });
    expect(consolidatedPatch, "PATCH /products/fp-w138 consolidé envoyé").toBeTruthy();

    const body = JSON.parse((consolidatedPatch![1] as { body: string }).body) as {
      variants?: { id?: string; sku?: string }[];
      variant_option_sets?: { name: string; values: string[] }[];
    };
    expect(body.variant_option_sets).toBeTruthy();
    expect(body.variants).toBeTruthy();
    // La variante Écru doit être envoyée SANS `id` — sinon Faire répond
    // « Invalid product variant IDs: [po_grj7cer22b] » (HTTP 400).
    const ecruEntry = body.variants!.find((v) => v.sku === STALE_SKU);
    expect(ecruEntry).toBeTruthy();
    expect(ecruEntry!.id).toBeUndefined();
    // La variante Blanc, elle, garde son vid valide (mise à jour).
    const blancEntry = body.variants!.find((v) => v.sku === OK_SKU);
    expect(blancEntry!.id).toBe(OK_VID);
  });

  it("persiste le nouveau faireVariantId retourné par Faire pour la variante recréée", async () => {
    await faireUpdateProduct("p-w138");

    const persisted = prismaProductColorUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as { where?: { id?: string }; data?: { faireVariantId?: string | null } };
      return (
        args?.where?.id === BJ_STALE_VARIANT_ID &&
        args?.data?.faireVariantId === RECREATED_VID
      );
    });
    expect(persisted, "productColor.update(vid → RECREATED_VID) doit être appelé après réponse Faire").toBeTruthy();
  });

  it("ne PATCH PAS le vid stale individuellement (aucun HTTP 404 attendu)", async () => {
    await faireUpdateProduct("p-w138");

    const patchOnStale = faireFetchSpy.mock.calls.find(([url, init]) => {
      const method = (init as { method?: string } | undefined)?.method ?? "GET";
      return method === "PATCH" && url.includes(`/variants/${encodeURIComponent(STALE_VID)}`);
    });
    expect(patchOnStale, "aucun PATCH direct sur le vid stale").toBeUndefined();
  });
});
