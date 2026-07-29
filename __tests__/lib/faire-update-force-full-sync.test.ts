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
    siteConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    $transaction: (...a: unknown[]) => prismaTransactionSpy(...a),
  },
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantIdSafe: vi.fn().mockResolvedValue(null),
  getTenantBaseUrl: vi.fn().mockResolvedValue(null),
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
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedFaireMadeInExcluded: vi.fn().mockResolvedValue([]),
}));

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

  // Par défaut, le GET /products/{id} de réconciliation retourne les 2 vids
  // BJ ↔ Faire connus : la purge des vids stales ne trouve rien à corriger,
  // donc le flow tourne exactement comme avant l'ajout de la réconciliation.
  faireFetchSpy.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      variants: VARIANT_SKUS.map((sku) => ({ id: `po_${sku}`, sku })),
    }),
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
  it("avec forceFullSync=true : le PATCH /products/{id} inclut variants[].prices[] avec retail_price ET wholesale_price (chemin fiable pour retail)", async () => {
    // Régression liaison Faire (2026-07-29) : quand l'admin lie une fiche BJ à
    // un produit Faire existant, `retail_price` restait celui du portail Faire
    // (le batch /product-prices/by-skus est INCONSTANT pour le retail). La
    // parade est de porter les prix aussi dans le PATCH consolidé
    // /products/{id} via `variants[].prices[]` (chemin fiable 100 % —
    // cf. docs/faire-api.md:63). Ce test garantit que le body PATCH inclut
    // bien cette structure sur un forceFullSync.
    buildFaireProductPayloadSpy.mockReturnValueOnce({
      body: {
        name: "Bracelet",
        lifecycle_state: "PUBLISHED",
        // Aligne le mock sur le vrai buildFaireProductPayload qui pose
        // `body.variants = variants.map(v => v.payload)`.
        variants: VARIANT_SKUS.map((sku) => ({
          id: `po_${sku}`,
          sku,
          name: sku,
          active: true,
          options: [{ name: "Color", value: sku }],
          prices: [
            {
              geo_constraint: { country_group: "EUROPEAN_UNION" },
              wholesale_price: { amount_minor: 800, currency: "EUR" },
              retail_price: { amount_minor: 2000, currency: "EUR" },
            },
          ],
        })),
      },
      variants: VARIANT_SKUS.map((sku) => ({
        bjVariantId: `v-${sku}`,
        sku,
        wholesalePriceCents: 800,
        retailPriceCents: 2000,
        payload: {
          id: `po_${sku}`,
          sku,
          name: sku,
          active: true,
          options: [{ name: "Color", value: sku }],
          prices: [
            {
              geo_constraint: { country_group: "EUROPEAN_UNION" },
              wholesale_price: { amount_minor: 800, currency: "EUR" },
              retail_price: { amount_minor: 2000, currency: "EUR" },
            },
          ],
          idempotence_token: sku,
          available_quantity: 5,
        },
      })),
      optionValues: VARIANT_SKUS,
      productImagesCount: 0,
      productImageUrls: [],
    });

    const res = await faireUpdateProduct("p-1", { forceFullSync: true });
    expect(res.success).toBe(true);

    const calls = faireFetchSpy.mock.calls as [string, { method?: string; body?: string }?][];
    const patchProduct = calls.find(
      ([url, init]) => url.endsWith(`/products/${encodeURIComponent("fp-1")}`) && init?.method === "PATCH",
    );
    expect(patchProduct, "PATCH /products/{id} envoyé").toBeTruthy();

    const body = JSON.parse(patchProduct![1]!.body!) as {
      variants?: Array<{
        id?: string;
        prices?: Array<{
          wholesale_price?: { amount_minor?: number };
          retail_price?: { amount_minor?: number };
        }>;
      }>;
    };
    expect(Array.isArray(body.variants), "variants[] présent dans le PATCH").toBe(true);
    expect(body.variants!.length).toBe(VARIANT_SKUS.length);
    for (const v of body.variants!) {
      expect(v.prices, `prices[] présent pour ${v.id}`).toBeDefined();
      expect(v.prices![0].retail_price?.amount_minor, `retail_price posé pour ${v.id}`).toBe(2000);
      expect(v.prices![0].wholesale_price?.amount_minor, `wholesale_price posé pour ${v.id}`).toBe(800);
    }
  });

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

  it("avec forceFullSync=true : pousse les images des variantes via PATCH /variants/{id} après DELETE des anciennes", async () => {
    // Régression PS3 : l'ajout d'une nouvelle image sur une variante ne
    // partait jamais vers Faire, même après clic sur « Synchroniser ». Le
    // diff « null prev » excluait par défaut les images pour éviter l'erreur
    // « 2 images principales ». Depuis, `forceFullSync` demande explicitement
    // au diff d'inclure les images (le DELETE préalable évite le doublon).
    buildFaireProductPayloadSpy.mockReturnValueOnce({
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
          images: [
            { url: `https://example.com/${sku}-1.jpg?format=jpeg&minWidth=1000` },
            { url: `https://example.com/${sku}-2.jpg?format=jpeg&minWidth=1000` },
          ],
        },
      })),
      optionValues: ["Or", "Argent"],
      productImagesCount: 0,
      productImageUrls: [],
    });
    // GET produit (pour récupérer les IDs d'images existantes côté Faire).
    faireFetchSpy.mockImplementation(async (url: string, init?: { method?: string }) => {
      if ((init?.method ?? "GET") === "GET") {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => ({
            variants: VARIANT_SKUS.map((sku) => ({
              id: `po_${sku}`,
              sku,
              images: [{ id: `img_old_${sku}` }],
            })),
          }),
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
    });

    const res = await faireUpdateProduct("p-1", { forceFullSync: true });
    expect(res.success).toBe(true);

    const calls = faireFetchSpy.mock.calls as [string, { method?: string }?][];

    // 1. On DELETE les anciennes images de chaque variante avant de re-PATCH.
    for (const sku of VARIANT_SKUS) {
      const deleted = calls.some(([url, init]) =>
        url.includes(`/variants/${encodeURIComponent(`po_${sku}`)}/images/${encodeURIComponent(`img_old_${sku}`)}`) &&
        init?.method === "DELETE",
      );
      expect(deleted, `DELETE image ancienne pour ${sku}`).toBe(true);
    }

    // 2. Chaque variante reçoit un PATCH avec ses NOUVELLES images.
    for (const sku of VARIANT_SKUS) {
      const patch = calls.find(([url, init]) =>
        url.endsWith(`/variants/${encodeURIComponent(`po_${sku}`)}`) &&
        init?.method === "PATCH",
      );
      expect(patch, `PATCH variant ${sku} envoyé`).toBeTruthy();
      const body = JSON.parse((patch![1] as { body: string }).body) as {
        images?: { url: string }[];
      };
      expect(body.images).toHaveLength(2);
      expect(body.images![0].url).toContain(`${sku}-1.jpg`);
    }
  });
});
