/**
 * Régression bug 2026-09-11 (Issyma / 13369ROBE) :
 *
 * PFS peut renvoyer via `checkReference` une AUTRE fiche que celle liée
 * localement (match approximatif par nom + fantôme ARCHIVED / doublon
 * Salesforce historique). L'audit auto plantait alors sur
 * « Variante PFS BLACK/UNIT introuvable » parce que l'apply lisait les
 * variantes depuis l'ID PFS renvoyé par checkReference plutôt que depuis
 * notre lien local (source de vérité).
 *
 * Ces tests figent :
 *   1. `pfsGetVariants` est TOUJOURS appelée avec `local.pfsProductId`, jamais
 *      avec l'id renvoyé par `checkReference` — même en cas de mismatch.
 *   2. Quand les IDs ne matchent pas, un pull produit-level est refusé avec
 *      un message clair (garde-fou contre corruption de fiche) ; les pulls
 *      variant-level restent OK.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    product: { update: vi.fn().mockResolvedValue({}) },
    productColor: { update: vi.fn().mockResolvedValue({}) },
    productComposition: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return {
    txMock: tx,
    prismaMock: {
      product: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      composition: { findMany: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const pfsApiMocks = vi.hoisted(() => ({
  pfsCheckReference: vi.fn(),
  pfsGetVariants: vi.fn(),
}));
vi.mock("@/lib/pfs-api", () => pfsApiMocks);

vi.mock("@/lib/pfs-api-write", () => ({
  pfsUpdateProduct: vi.fn(),
  pfsPatchVariants: vi.fn(),
  pfsSetVariantsAvailability: vi.fn(),
  pfsUpdateStatus: vi.fn(),
}));
vi.mock("@/lib/pfs-status", () => ({ mapLocalToPfsStatus: vi.fn() }));
vi.mock("@/lib/marketplace-pricing", () => ({
  applyMarketplaceMarkup: vi.fn((price: number) => price),
  loadMarketplaceMarkupConfigs: vi
    .fn()
    .mockResolvedValue({ pfs: { type: "percent", value: 0, rounding: "none" } }),
}));
vi.mock("@/lib/pfs-verify-variant-ops", () => ({
  pushAddPfsVariantFromLocal: vi.fn(),
  pushRemovePfsVariant: vi.fn(),
  pullAddLocalVariantFromPfs: vi.fn(),
  pullRemoveLocalVariant: vi.fn(),
}));
vi.mock("@/lib/pfs-admin-api", () => ({
  pfsAdminFetchMaterialComposition: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/pfs-import", () => ({ createOrLinkMapping: vi.fn() }));
vi.mock("@/lib/product-variant-validation", () => ({
  clampStock: (n: number) => n,
  MAX_STOCK: 1000,
}));

import { applyPfsVerifyPullsOnly } from "@/lib/pfs-verify-apply";

const LOCAL_PFS_PRODUCT_ID = "pro_4b8a41b38b18978b56209672f722";
const CHECKREF_FANTOME_ID = "a0AW5000000RTlwMAG";
const LOCAL_PFS_VARIANT_ID_BLACK = "pro_e0bdf88112edf404179b6b2ffbd1";

const buildLocalProduct = () => ({
  id: "prod-local",
  reference: "13369ROBE",
  name: "Robe test",
  description: "",
  status: "ONLINE",
  isBestSeller: false,
  pfsProductId: LOCAL_PFS_PRODUCT_ID,
  pfsLastSyncSnapshot: null,
  tenantId: "t-issyma",
  dimensionLength: null,
  dimensionWidth: null,
  dimensionHeight: null,
  dimensionDiameter: null,
  dimensionCircumference: null,
  countryIsoCode: null,
  ankorsProductId: null,
  efashionReferenceBase: null,
  faireProductId: null,
  category: null,
  season: null,
  compositions: [],
  colors: [
    {
      id: "pc-black",
      pfsVariantId: LOCAL_PFS_VARIANT_ID_BLACK,
      unitPrice: 10,
      weight: 0.2,
      stock: 298,
      saleType: "UNIT",
      packQuantity: 1,
      disabled: false,
      colorId: "col-black",
      color: { pfsColorRef: "BLACK", name: "Noir" },
      pfsColorRefOverride: null,
    },
  ],
});

const buildCheckRefFantome = () => ({
  exists: true,
  product: {
    id: CHECKREF_FANTOME_ID,
    reference: "13369ROBE",
    label: { fr: "Autre fiche fantôme" },
    description: { fr: "" },
    material_composition: [],
  },
});

const buildCheckRefOk = () => ({
  exists: true,
  product: {
    id: LOCAL_PFS_PRODUCT_ID,
    reference: "13369ROBE",
    label: { fr: "Robe test" },
    description: { fr: "" },
    material_composition: [],
  },
});

const buildPfsVariantBlack = (stockOnPfs: number) => ({
  id: LOCAL_PFS_VARIANT_ID_BLACK,
  type: "ITEM",
  is_active: true,
  weight: 0.2,
  stock_qty: stockOnPfs,
  price_sale: { unit: { value: 10 } },
  item: { color: { reference: "BLACK", labels: { fr: "Noir" } } },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyPfsVerifyPullsOnly — parade contre checkReference fantôme", () => {
  it("charge les variantes via local.pfsProductId même si checkReference renvoie une autre fiche", async () => {
    prismaMock.product.findUnique.mockResolvedValue(buildLocalProduct());
    pfsApiMocks.pfsCheckReference.mockResolvedValue(buildCheckRefFantome());
    pfsApiMocks.pfsGetVariants.mockResolvedValue({ data: [buildPfsVariantBlack(297)] });

    const { report } = await applyPfsVerifyPullsOnly("prod-local", [
      {
        key: `color:stock:BLACK:UNIT:${LOCAL_PFS_VARIANT_ID_BLACK}`,
        direction: "pull",
      },
    ]);

    expect(pfsApiMocks.pfsGetVariants).toHaveBeenCalledTimes(1);
    expect(pfsApiMocks.pfsGetVariants).toHaveBeenCalledWith(LOCAL_PFS_PRODUCT_ID);
    expect(pfsApiMocks.pfsGetVariants).not.toHaveBeenCalledWith(CHECKREF_FANTOME_ID);
    expect(report.errors).toEqual([]);
    expect(report.applied).toHaveLength(1);
  });

  it("refuse un pull produit-level avec un message clair quand checkReference renvoie une autre fiche", async () => {
    prismaMock.product.findUnique.mockResolvedValue(buildLocalProduct());
    pfsApiMocks.pfsCheckReference.mockResolvedValue(buildCheckRefFantome());
    pfsApiMocks.pfsGetVariants.mockResolvedValue({ data: [buildPfsVariantBlack(297)] });

    const { report } = await applyPfsVerifyPullsOnly("prod-local", [
      { key: "product:name:::", direction: "pull" },
    ]);

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.error).toMatch(/autre fiche/i);
    expect(report.errors[0]?.error).toContain("13369ROBE");
  });

  it("laisse passer les pulls produit-level quand les IDs matchent", async () => {
    prismaMock.product.findUnique.mockResolvedValue(buildLocalProduct());
    pfsApiMocks.pfsCheckReference.mockResolvedValue(buildCheckRefOk());
    pfsApiMocks.pfsGetVariants.mockResolvedValue({ data: [buildPfsVariantBlack(297)] });

    const { report } = await applyPfsVerifyPullsOnly("prod-local", [
      { key: "product:name:::", direction: "pull" },
    ]);

    expect(report.errors).toEqual([]);
    expect(report.applied).toHaveLength(1);
    expect(pfsApiMocks.pfsGetVariants).toHaveBeenCalledWith(LOCAL_PFS_PRODUCT_ID);
  });
});
