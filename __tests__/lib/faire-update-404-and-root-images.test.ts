/**
 * Régressions 2026-07-28 :
 *
 *   1. HTTP 404 sur PATCH /products/{faireProductId} — quand le produit a
 *      été supprimé côté portail Faire, notre BDD garde un `faireProductId`
 *      orphelin. Faire répond `{ status_code: 404, message: "p_xxx" }`.
 *      L'ancien message d'erreur remonté à la cliente était incompréhensible
 *      (« Faire a refusé la mise à jour (HTTP 404) : p_9t2phgs4kt »). On
 *      surface désormais un message clair invitant à relier la fiche.
 *
 *   2. Parade « 2 images principales » — quand on force un resync et que
 *      les images ne portent PAS le tag « Hero » (cas vu sur A2521E
 *      "Parure de bijoux en acier inoxydable"), l'ancienne parade ne
 *      supprimait rien, laissait Faire tenter de re-marquer les images
 *      envoyées comme « principales » et renvoyer HTTP 400. On DELETE
 *      maintenant TOUTES les images racine avant le PATCH quand
 *      `forceFullSync = true` (en gardant 1 image mini, contrainte Faire).
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
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { faireUpdateProduct } from "@/lib/faire-update";
import { FAIRE_SNAPSHOT_VERSION } from "@/lib/faire-sync-diff";

const SKU = "parure_or_UNIT_ab12";
const VID = "po_parure_or";
const FAIRE_PRODUCT_ID = "p_9t2phgs4kt";

function buildVariantSnapshot() {
  return {
    sku: SKU,
    wholesalePriceCents: 500,
    retailPriceCents: 1250,
    availableQuantity: 100,
    active: true,
    colorOption: "Or",
    images: ["https://example.com/parure-or.jpg"],
    weightGrams: 15,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    tariffCode: null,
    faireVariantId: VID,
  };
}

function buildSnapshot() {
  return {
    schemaVersion: FAIRE_SNAPSHOT_VERSION,
    product: {
      name: "Parure de bijoux en acier inoxydable",
      shortDescription: "court",
      description: "long",
      taxonomyTypeId: "tt_x",
      countryAlpha2: "CN",
      minimumOrderQuantity: 1,
      perStyleMinimumOrderQuantity: 1,
      images: [],
    },
    variants: { [SKU]: buildVariantSnapshot() },
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
      name: "Parure de bijoux en acier inoxydable",
      lifecycle_state: "PUBLISHED",
      images: [{ url: "https://example.com/parure-or.jpg?format=jpeg&minWidth=1000" }],
    },
    variants: [
      {
        bjVariantId: "v-or",
        sku: SKU,
        wholesalePriceCents: 500,
        retailPriceCents: 1250,
        payload: {
          sku: SKU,
          name: "Or",
          active: true,
          options: [{ name: "Color", value: "Or" }],
          prices: [],
          idempotence_token: SKU,
          available_quantity: 100,
        },
      },
    ],
    optionValues: ["Or"],
    productImagesCount: 1,
    productImageUrls: ["https://example.com/parure-or.jpg"],
  });
  buildFaireSnapshotSpy.mockReturnValue(buildSnapshot());

  loadFaireProductFullSpy.mockResolvedValue({
    id: "p-parure",
    status: "ONLINE",
    colors: [{ id: "v-or", faireVariantId: VID, saleType: "UNIT" }],
  });

  prismaFindUniqueSpy.mockResolvedValue({
    id: "p-parure",
    faireProductId: FAIRE_PRODUCT_ID,
    faireLastSyncSnapshot: buildSnapshot(),
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
});

describe("faireUpdateProduct — HTTP 404 = fiche disparue côté Faire", () => {
  it("remonte un message clair invitant à relier (pas l'id Faire brut)", async () => {
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
      if (method === "PATCH" && url === `/products/${FAIRE_PRODUCT_ID}`) {
        return {
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              status_code: 404,
              status_type: "Not Found",
              message: FAIRE_PRODUCT_ID,
              entity_tokens: [],
            }),
          json: async () => ({}),
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    });

    const res = await faireUpdateProduct("p-parure", { forceFullSync: true });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe(
        "Produit non existant sur Faire — veuillez le relier depuis la modale Faire.",
      );
      expect(res.error).not.toContain(FAIRE_PRODUCT_ID);
    }
  });
});

describe("faireUpdateProduct — forceFullSync DELETE toutes les images racine", () => {
  it("supprime les images racine SANS tag « Hero » avant le PATCH (parade « 2 images principales »)", async () => {
    // Faire renvoie 2 images racine, aucune n'a le tag Hero (cas A2521E).
    const rootImgIds = ["img_root_1", "img_root_2"];
    let patchCalled = false;
    faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === `/products/${FAIRE_PRODUCT_ID}`) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            variants: [{ id: VID, sku: SKU, images: [] }],
            images: rootImgIds.map((id) => ({ id })), // pas de tags
          }),
        };
      }
      if (method === "PATCH" && url === `/products/${FAIRE_PRODUCT_ID}`) {
        patchCalled = true;
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ variants: [{ id: VID, sku: SKU }] }),
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    });

    const res = await faireUpdateProduct("p-parure", { forceFullSync: true });
    expect(res.success).toBe(true);

    const calls = faireFetchSpy.mock.calls as [string, { method?: string }?][];

    // 1 des 2 images racine doit être DELETE avant le PATCH product (Faire
    // interdit de supprimer la DERNIÈRE image → on garde 1 image mini).
    const deletedRootIds = calls
      .filter(
        ([url, init]) =>
          init?.method === "DELETE" &&
          url.startsWith(`/products/${FAIRE_PRODUCT_ID}/images/`),
      )
      .map(([url]) => decodeURIComponent(url.split("/").pop() ?? ""));

    expect(deletedRootIds.length).toBeGreaterThanOrEqual(1);
    for (const id of deletedRootIds) {
      expect(rootImgIds).toContain(id);
    }
    // On ne supprime PAS les 2 (contrainte « au moins 1 image en stock »).
    expect(deletedRootIds.length).toBeLessThan(rootImgIds.length);

    expect(patchCalled).toBe(true);
  });

  it("hors forceFullSync : ne touche pas aux images racine sans tag Hero", async () => {
    const rootImgIds = ["img_root_1", "img_root_2"];
    // Modifie le snapshot pour forcer productImagesChanged sans forceFullSync :
    // on présente au diff un snapshot précédent où les images racine sont
    // différentes de l'état cible.
    prismaFindUniqueSpy.mockResolvedValueOnce({
      id: "p-parure",
      faireProductId: FAIRE_PRODUCT_ID,
      faireLastSyncSnapshot: {
        ...buildSnapshot(),
        product: { ...buildSnapshot().product, images: ["https://old.example.com/x.jpg"] },
      },
    });
    buildFaireSnapshotSpy.mockReturnValue({
      ...buildSnapshot(),
      product: {
        ...buildSnapshot().product,
        images: ["https://example.com/parure-or.jpg"],
      },
    });

    faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === `/products/${FAIRE_PRODUCT_ID}`) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            variants: [{ id: VID, sku: SKU, images: [] }],
            images: rootImgIds.map((id) => ({ id })), // toujours pas de tag Hero
          }),
        };
      }
      if (method === "PATCH" && url === `/products/${FAIRE_PRODUCT_ID}`) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({ variants: [{ id: VID, sku: SKU }] }),
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    });

    await faireUpdateProduct("p-parure"); // pas de forceFullSync

    const calls = faireFetchSpy.mock.calls as [string, { method?: string }?][];
    const deletedRootIds = calls.filter(
      ([url, init]) =>
        init?.method === "DELETE" &&
        url.startsWith(`/products/${FAIRE_PRODUCT_ID}/images/`),
    );
    // Aucun DELETE d'image racine : les images n'ont pas le tag Hero, donc
    // en mode nominal on n'y touche pas (comportement d'avant).
    expect(deletedRootIds).toHaveLength(0);
  });
});
