/**
 * Régression 2026-09-09 : quand une variante BJ n'a PAS de `faireVariantId` en
 * BDD mais que Faire connaît déjà une variante avec le même SKU, chaque tentative
 * de synchro envoyait la variante SANS id → Faire refusait le PATCH avec
 * HTTP 400 « Duplicate variants with same options ». Boucle d'erreurs jusqu'à
 * réparation manuelle.
 *
 * Cas concret : W124 (bracelet jonc thaïlandaise) — cliente supprime la couleur
 * Bleu et ajoute Marine, save + push Faire. Faire crée Marine côté portail
 * (`po_aswmet5p84`) mais un timeout casse la chaîne avant que notre code n'ait
 * persisté l'id. Depuis, chaque push refusé.
 *
 * Correctif : avant de bâtir `newVariantsToCreate`, on GET l'état Faire et
 * pour chaque variante orpheline (sans faireVariantId BDD), on adopte l'id
 * Faire si un SKU identique existe déjà chez eux. On persiste le vid en BDD
 * et on injecte le `id` dans le body du PATCH.
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
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedFaireMadeInExcluded: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantIdSafe: vi.fn().mockResolvedValue(null),
  getTenantBaseUrl: vi.fn().mockResolvedValue(null),
}));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const OK_SKU = "w124_blanc_UNIT_00000001";
const OK_VID = "po_ok_valid";
const ORPHAN_SKU = "w124_marine_UNIT_92yowr8w";
const ORPHAN_FAIRE_VID = "po_aswmet5p84"; // Existe chez Faire, PAS en BDD BJ.
const BJ_MARINE_VARIANT_ID = "v-marine";

function variantSnapshot(sku: string, colorOption: string, faireVariantId: string | null) {
  return {
    sku,
    wholesalePriceCents: 390,
    retailPriceCents: 970,
    availableQuantity: 300,
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

function prevSnapshot() {
  // Snapshot précédent : uniquement la variante Blanc. Marine ajoutée depuis.
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet jonc",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: {
      [OK_SKU]: variantSnapshot(OK_SKU, "Blanc", OK_VID),
    },
    lifecycleState: "PUBLISHED" as const,
  };
}

function nextSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Bracelet jonc",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: {
      [OK_SKU]: variantSnapshot(OK_SKU, "Blanc", OK_VID),
      // Marine côté snapshot next : pas de faireVariantId (BDD orpheline).
      [ORPHAN_SKU]: variantSnapshot(ORPHAN_SKU, "Marine", null),
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
  // Le payload initial construit par buildFaireProductPayload : la variante
  // Marine n'a PAS de `id` (BDD orpheline). C'est ce que ferait le vrai code.
  buildFaireProductPayloadSpy.mockReturnValue({
    body: {
      name: "Bracelet jonc",
      lifecycle_state: "PUBLISHED",
      variant_option_sets: [{ name: "Color", values: ["Blanc", "Marine"] }],
      variants: [
        {
          id: OK_VID,
          sku: OK_SKU,
          options: [{ name: "Color", value: "Blanc" }],
          active: true,
          available_quantity: 300,
        },
        {
          // PAS de `id` — orpheline BDD.
          sku: ORPHAN_SKU,
          options: [{ name: "Color", value: "Marine" }],
          active: true,
          available_quantity: 300,
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
          available_quantity: 300,
        },
      },
      {
        bjVariantId: BJ_MARINE_VARIANT_ID,
        sku: ORPHAN_SKU,
        wholesalePriceCents: 390,
        retailPriceCents: 970,
        payload: {
          sku: ORPHAN_SKU,
          name: "Marine",
          active: true,
          options: [{ name: "Color", value: "Marine" }],
          prices: [],
          idempotence_token: ORPHAN_SKU,
          available_quantity: 300,
        },
      },
    ],
    optionValues: ["Blanc", "Marine"],
    productImagesCount: 0,
    productImageUrls: [],
  });
  buildFaireSnapshotSpy.mockReturnValue(nextSnapshot());

  // BDD : la variante Marine BJ existe SANS faireVariantId.
  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-w124",
    status: "ONLINE",
    colors: [
      { id: "v-blanc", faireVariantId: OK_VID, saleType: "UNIT" },
      { id: BJ_MARINE_VARIANT_ID, faireVariantId: null, saleType: "UNIT" },
    ],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-w124",
    faireProductId: "fp-w124",
    faireLastSyncSnapshot: prevSnapshot(),
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

  // Faire GET connaît DÉJÀ Marine (id ORPHAN_FAIRE_VID) — c'est la situation
  // qui doit déclencher l'adoption.
  faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => ({
          variants: [
            {
              id: OK_VID,
              sku: OK_SKU,
              options: [{ name: "Color", value: "Blanc" }],
              images: [],
            },
            {
              id: ORPHAN_FAIRE_VID,
              sku: ORPHAN_SKU,
              options: [{ name: "Color", value: "Marine" }],
              images: [],
            },
          ],
          images: [],
          variant_option_sets: [{ name: "Color", values: ["Blanc", "Marine"] }],
        }),
      };
    }
    // PATCH variant + autres : réponses génériques OK.
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  });
});

describe("faireUpdateProduct — adoption des vids orphelins par SKU", () => {
  it("persiste le vid Faire orphelin dans ProductColor.faireVariantId", async () => {
    const res = await faireUpdateProduct("p-w124");
    expect(res.success).toBe(true);

    const adoption = prismaProductColorUpdateSpy.mock.calls.find((call) => {
      const args = call[0] as {
        where?: { id?: string };
        data?: { faireVariantId?: string | null };
      };
      return (
        args?.where?.id === BJ_MARINE_VARIANT_ID &&
        args?.data?.faireVariantId === ORPHAN_FAIRE_VID
      );
    });
    expect(
      adoption,
      "productColor.update(faireVariantId=po_aswmet5p84) doit être appelé pour Marine",
    ).toBeTruthy();
  });

  it("ne renvoie PAS Marine dans un PATCH consolidé sans id (source du Duplicate variants)", async () => {
    await faireUpdateProduct("p-w124");

    for (const [url, init] of faireFetchSpy.mock.calls) {
      const method = (init as { method?: string } | undefined)?.method ?? "GET";
      if (method !== "PATCH" || url !== "/products/fp-w124") continue;
      const body = JSON.parse((init as { body: string }).body) as {
        variants?: { id?: string; sku?: string }[];
      };
      const marineEntry = body.variants?.find((v) => v.sku === ORPHAN_SKU);
      if (marineEntry) {
        expect(
          marineEntry.id,
          "Marine ne doit jamais partir sans id après adoption",
        ).toBe(ORPHAN_FAIRE_VID);
      }
    }
  });

  it("PATCH la variante Marine adoptée via /variants/{orphanVid} (comme une existante)", async () => {
    await faireUpdateProduct("p-w124");

    const patchMarine = faireFetchSpy.mock.calls.find(([url, init]) => {
      const method = (init as { method?: string } | undefined)?.method ?? "GET";
      return (
        method === "PATCH" &&
        url === `/products/fp-w124/variants/${ORPHAN_FAIRE_VID}`
      );
    });
    expect(
      patchMarine,
      "PATCH direct sur po_aswmet5p84 attendu après adoption",
    ).toBeTruthy();
  });
});
