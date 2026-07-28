import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  MICROSTORE_API_HEADERS,
  bucketProductByColor,
  productToMicrostoreApiRows,
  microstoreImportProducts,
} from "@/lib/microstore-products";
import { MicrostoreSessionExpiredError } from "@/lib/microstore-client";
import type {
  ExportContext,
  ExportProduct,
  ExportVariant,
} from "@/lib/marketplace-excel/types";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/microstore-auth", () => ({
  buildMicrostoreUrl: vi.fn(async (path: string, extra?: Record<string, string>) => {
    const url = new URL(`https://api2.dokkr.net/index.php${path}`);
    url.searchParams.set("key", "TEST_SESSION_KEY");
    url.searchParams.set("pid", "5");
    url.searchParams.set("lang", "fr");
    for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
    return url.toString();
  }),
  getMicrostoreSessionKey: vi.fn(),
  isMicrostoreSessionExpiredError: (err?: number) =>
    err === 6011 || err === 6061 || err === 6001,
}));

const noMarkup = {
  type: "percent" as const,
  value: 0,
  rounding: "none" as const,
};

function makeCtx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    shopName: "Beli & Jolie",
    publicBaseUrl: "https://beliandjolie.com",
    markups: {
      pfs: noMarkup,
      efashion: noMarkup,
      microstore: noMarkup,
      ankorstoreWholesale: noMarkup,
      ankorstoreRetail: noMarkup,
      ankorstoreVatRate: 20,
      faireWholesale: noMarkup,
      faireRetail: noMarkup,
    },
    ...over,
  };
}

function makeVariant(over: Partial<ExportVariant> = {}): ExportVariant {
  return {
    variantId: "v1",
    saleType: "UNIT",
    colorNames: ["Doré"],
    packQuantity: null,
    sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
    unitPrice: 4.2,
    weight: 0.025,
    stock: 12,
    sku: null,
    imagePaths: [],
    ...over,
  };
}

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "W140",
    name: "Bracelet jonc thaïlandaise en laiton",
    description: "Bracelet jonc thaïlandaise en laiton",
    pfsGenderCode: "WOMAN",
    pfsFamilyName: "Bijoux_Fantaisie",
    pfsCategoryName: "Bracelets",
    categoryName: "Bracelet",
    microstoreCategoryOverride: null,
    hsCode: "711719",
    efashionCategorieId: null,
    efashionCategoryPath: null,
    seasonPfsRef: null,
    seasonEfashionCollectionId: null,
    seasonEfashionLabel: null,
    seasonName: null,
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    manufacturingCountryEfashionProvenanceId: null,
    compositions: [{ name: "BRASS", percentage: 100 }],
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    translations: {},
    variants: [makeVariant()],
    ...over,
  };
}

describe("MICROSTORE_API_HEADERS", () => {
  it("expose exactement les 17 colonnes anglaises du HAR API dans l'ordre", () => {
    expect([...MICROSTORE_API_HEADERS]).toEqual([
      "item_ref",
      "name",
      "category",
      "remark_package",
      "remark_material",
      "brand",
      "year",
      "season",
      "unit_number",
      "color",
      "stock",
      "stock_piece",
      "weight",
      "price",
      "product_country",
      "sale",
      "desc",
    ]);
  });
});

describe("bucketProductByColor", () => {
  it("produit une entrée par couleur unique en UNIT", () => {
    const product = makeProduct({
      variants: [
        makeVariant({ variantId: "v1", colorNames: ["Vert"] }),
        makeVariant({ variantId: "v2", colorNames: ["Rose"] }),
        makeVariant({ variantId: "v3", colorNames: ["Vert"] }), // doublon
      ],
    });
    expect(bucketProductByColor(product).map((b) => b.colorName)).toEqual([
      "Vert",
      "Rose",
    ]);
  });

  it("exclut les variantes PACK — Microstore n'accepte que l'unité", () => {
    const product = makeProduct({
      variants: [
        makeVariant({ variantId: "vpack", saleType: "PACK", colorNames: ["Multi"] }),
      ],
    });
    expect(bucketProductByColor(product)).toEqual([]);
  });
});

describe("productToMicrostoreApiRows", () => {
  it("produit 1 ligne par couleur avec les 17 colonnes dans l'ordre", () => {
    const product = makeProduct({
      variants: [
        makeVariant({ variantId: "v1", colorNames: ["Vert"], stock: 100 }),
        makeVariant({ variantId: "v2", colorNames: ["Rose"], stock: 50 }),
      ],
    });
    const rows = productToMicrostoreApiRows(product, makeCtx(), 2026);
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveLength(MICROSTORE_API_HEADERS.length);
    expect(rows[1]!).toHaveLength(MICROSTORE_API_HEADERS.length);
  });

  it("mappe correctement chaque colonne (item_ref, marque, année, saison…)", () => {
    const rows = productToMicrostoreApiRows(makeProduct(), makeCtx({ shopName: "FORCYMA" }), 2026);
    const row = rows[0]!;
    expect(row[0]).toBe("W140"); // item_ref
    expect(row[1]).toBe("Bracelet jonc thaïlandaise en laiton"); // name
    expect(row[2]).toBe("Bracelet"); // category
    expect(row[3]).toBe(1); // remark_package (fixe)
    expect(row[4]).toBe("100% BRASS"); // remark_material (composition)
    expect(row[5]).toBe("FORCYMA"); // brand = shopName
    expect(row[6]).toBe(2026); // year
    expect(row[7]).toBe("Toutes saisons"); // season (fallback)
    expect(row[8]).toBe(1); // unit_number (fixe)
    expect(row[9]).toBe("Doré"); // color
    expect(row[10]).toBe(12); // stock
    expect(row[11]).toBe(12); // stock_piece = même valeur que stock (l'API Microstore utilise stock_piece comme stock effectif)
    expect(row[12]).toBe(25); // weight = 0.025 kg × 1000 = 25 g
    expect(row[13]).toBe(4.2); // price
    expect(row[14]).toBe("Chine"); // product_country
    expect(row[15]).toBe(""); // sale (vide)
    expect(row[16]).toBe("Bracelet jonc thaïlandaise en laiton"); // desc
  });

  it("respecte microstoreCategoryOverride quand la cliente a choisi une sous-catégorie", () => {
    const rows = productToMicrostoreApiRows(
      makeProduct({ microstoreCategoryOverride: "Bracelets fins" }),
      makeCtx(),
      2026,
    );
    expect(rows[0]![2]).toBe("Bracelets fins");
  });

  it("applique le markup Microstore sur le prix (percent)", () => {
    const ctx = makeCtx({
      markups: {
        ...makeCtx().markups,
        microstore: { type: "percent", value: 20, rounding: "none" },
      },
    });
    const rows = productToMicrostoreApiRows(makeProduct(), ctx, 2026);
    // 4.20 × 1.20 = 5.04
    expect(rows[0]![13]).toBeCloseTo(5.04, 2);
  });

  it("utilise la saison locale du produit quand elle existe", () => {
    const rows = productToMicrostoreApiRows(
      makeProduct({ seasonName: "PE2026" }),
      makeCtx(),
      2026,
    );
    expect(rows[0]![7]).toBe("PE2026");
  });

  it("utilise l'année en cours quand aucune n'est passée", () => {
    const currentYear = new Date().getFullYear();
    const rows = productToMicrostoreApiRows(makeProduct(), makeCtx());
    expect(rows[0]![6]).toBe(currentYear);
  });
});

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

describe("microstoreImportProducts", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    const auth = await import("@/lib/microstore-auth");
    (auth.getMicrostoreSessionKey as ReturnType<typeof vi.fn>).mockReset();
    (auth.getMicrostoreSessionKey as ReturnType<typeof vi.fn>).mockResolvedValue(
      "TEST_SESSION_KEY",
    );
    mocks.fetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throw MicrostoreSessionExpiredError quand la clé de session est absente", async () => {
    const auth = await import("@/lib/microstore-auth");
    (auth.getMicrostoreSessionKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      microstoreImportProducts([makeProduct()], makeCtx()),
    ).rejects.toBeInstanceOf(MicrostoreSessionExpiredError);
  });

  it("retourne success:true, productsSent=0 quand aucun produit UNIT n'est envoyable", async () => {
    const packOnly = makeProduct({
      variants: [makeVariant({ saleType: "PACK", colorNames: ["Multi"] })],
    });
    const res = await microstoreImportProducts([packOnly], makeCtx());
    expect(res).toEqual({ success: true, productsSent: 0, rowsSent: 0 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("envoie un POST multipart avec shop_id + stock_incremental + data + attrs", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ err: 0, msg: "Succès" }),
    });
    const res = await microstoreImportProducts([makeProduct()], makeCtx());
    expect(res.success).toBe(true);
    expect(res.productsSent).toBe(1);
    expect(res.rowsSent).toBe(1);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0]!;
    expect(String(url)).toContain("/goods/import_v1");
    expect(String(url)).toContain("key=TEST_SESSION_KEY");
    const body = init?.body as FormData;
    expect(body.get("shop_id")).toBe("1");
    expect(body.get("stock_incremental")).toBe("0");
    // data = [headers, ...rows]
    const parsedData = JSON.parse(String(body.get("data")));
    expect(parsedData[0]).toEqual([...MICROSTORE_API_HEADERS]);
    expect(parsedData).toHaveLength(2); // headers + 1 ligne
  });

  it("stock_incremental=1 quand opts.stockIncremental=true", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ err: 0, msg: "OK" }),
    });
    await microstoreImportProducts([makeProduct()], makeCtx(), {
      stockIncremental: true,
    });
    const body = mocks.fetch.mock.calls[0]![1]!.body as FormData;
    expect(body.get("stock_incremental")).toBe("1");
  });

  it("retourne success:false avec le msg Microstore quand err != 0", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ err: 4020, msg: "Reference déjà utilisée" }),
    });
    const res = await microstoreImportProducts([makeProduct()], makeCtx());
    expect(res.success).toBe(false);
    expect(res.error).toBe("Reference déjà utilisée");
    expect(res.errCode).toBe(4020);
  });

  it("throw MicrostoreSessionExpiredError quand Microstore renvoie err de session expirée (6011)", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ err: 6011, msg: "session expired" }),
    });
    await expect(
      microstoreImportProducts([makeProduct()], makeCtx()),
    ).rejects.toBeInstanceOf(MicrostoreSessionExpiredError);
  });

  it("agrège plusieurs produits en un seul appel (bulk = 1 seul POST)", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ err: 0, msg: "OK" }),
    });
    const p1 = makeProduct({ id: "p1", reference: "W139" });
    const p2 = makeProduct({ id: "p2", reference: "W140" });
    const res = await microstoreImportProducts([p1, p2], makeCtx());
    expect(res.rowsSent).toBe(2);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const body = mocks.fetch.mock.calls[0]![1]!.body as FormData;
    const parsedData = JSON.parse(String(body.get("data")));
    expect(parsedData).toHaveLength(3); // headers + 2 rows
    expect(parsedData[1]![0]).toBe("W139");
    expect(parsedData[2]![0]).toBe("W140");
  });
});
