import { describe, it, expect } from "vitest";
import {
  faireSkuForVariant,
  formatFaireTariffCode,
  productToFaireRows,
} from "@/lib/marketplace-excel/generate-faire";
import type {
  ExportProduct,
  ExportVariant,
  ExportContext,
} from "@/lib/marketplace-excel/types";

const noMarkup = { type: "percent" as const, value: 0, rounding: "none" as const };

function makeCtx(): ExportContext {
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
      faireRetail: { type: "multiplier", value: 2.5, rounding: "none" },
    },
  };
}

function makeVariant(over: Partial<ExportVariant> = {}): ExportVariant {
  return {
    variantId: "v1",
    saleType: "UNIT",
    colorNames: ["Doré"],
    packQuantity: null,
    sizes: [{ name: "TU", quantity: 1, pfsSizeRef: "TU" }],
    unitPrice: 5,
    weight: 0.05,
    stock: 50,
    sku: null,
    imagePaths: ["/uploads/produits/e803/e803-dore-1.webp"],
    ...over,
  };
}

function makeProduct(over: Partial<ExportProduct> = {}): ExportProduct {
  return {
    id: "p1",
    reference: "E803",
    name: "Collier en acier",
    description: "Description du collier en acier inoxydable.",
    status: "ONLINE",
    pfsGenderCode: null,
    pfsFamilyName: null,
    pfsCategoryName: null,
    categoryName: "Colliers",
    microstoreCategoryOverride: null,
    hsCode: "7117.19.00",
    efashionCategorieId: null,
    efashionCategoryPath: null,
    seasonPfsRef: null,
    seasonEfashionCollectionId: null,
    seasonEfashionLabel: null,
    seasonName: null,
    manufacturingCountryName: "Chine",
    manufacturingCountryIso: "CN",
    manufacturingCountryEfashionProvenanceId: null,
    compositions: [{ name: "Acier Inoxydable", percentage: 100 }],
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    translations: {
      fr: { name: "Collier en acier", description: "Description du collier en acier inoxydable." },
    },
    variants: [makeVariant()],
    ...over,
  };
}

describe("formatFaireTariffCode", () => {
  it("tronque XXXX.XX.XX → XXXX.XX (format Faire HS6)", () => {
    expect(formatFaireTariffCode("7117.19.00")).toBe("7117.19");
  });

  it("garde XXXX.XX tel quel", () => {
    expect(formatFaireTariffCode("7117.19")).toBe("7117.19");
  });

  it("renvoie null pour entrée vide", () => {
    expect(formatFaireTariffCode("")).toBe(null);
    expect(formatFaireTariffCode(null)).toBe(null);
    expect(formatFaireTariffCode(undefined)).toBe(null);
  });

  it("renvoie la chaîne brute si pas le format ####.##", () => {
    expect(formatFaireTariffCode("ABCDE")).toBe("ABCDE");
  });
});

describe("faireSkuForVariant", () => {
  it("utilise la couleur en majuscules : E803_DORÉ", () => {
    const v = makeVariant({ colorNames: ["Doré"] });
    expect(faireSkuForVariant("E803", v, 0)).toBe("E803_DORÉ");
  });

  it("retombe sur V<index+1> sans couleur", () => {
    const v = makeVariant({ colorNames: [] });
    expect(faireSkuForVariant("X", v, 2)).toBe("X_V3");
  });
});

describe("productToFaireRows", () => {
  it("génère une ligne par variante UNIT", () => {
    const p = makeProduct({
      variants: [
        makeVariant({ variantId: "v1", colorNames: ["Doré"] }),
        makeVariant({ variantId: "v2", colorNames: ["Argent"] }),
      ],
    });
    const rows = productToFaireRows(p, makeCtx());
    expect(rows).toHaveLength(2);
  });

  it("ignore les variantes PACK (choix cliente 2026-06-27)", () => {
    const rows = productToFaireRows(
      makeProduct({
        variants: [
          makeVariant({ saleType: "PACK", packQuantity: 12, unitPrice: 60 }),
        ],
      }),
      makeCtx(),
    );
    expect(rows).toHaveLength(0);
  });

  it("met le nom du produit en colonne 1 (max 60 caractères)", () => {
    const longName = "A".repeat(80);
    const rows = productToFaireRows(makeProduct({ name: longName }), makeCtx());
    expect((rows[0]![0] as string).length).toBe(60);
  });

  it("colonne 6 selling_method = 'Par article' pour UNIT", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    expect(rows[0]![5]).toBe("Par article");
  });

  it("colonne 8 minimum_order_quantity = 1", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    expect(rows[0]![7]).toBe(1);
  });

  it("poids en kg (col 9) avec unité 'kg' (col 10)", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    expect(rows[0]![8]).toBe(0.05);
    expect(rows[0]![9]).toBe("kg");
  });

  it("option_1 = Couleur / valeur = nom couleur (cols 24-25)", () => {
    const rows = productToFaireRows(
      makeProduct({ variants: [makeVariant({ colorNames: ["Bleu nuit"] })] }),
      makeCtx(),
    );
    expect(rows[0]![23]).toBe("Couleur");
    expect(rows[0]![24]).toBe("Bleu nuit");
  });

  it("prix EUR wholesale (col 31) + retail (col 32) avec markup ×2,5", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    expect(rows[0]![30]).toBe(5); // wholesale 0% sur 5
    expect(rows[0]![31]).toBe(12.5); // retail ×2.5 sur 5
  });

  it("respecte le ratio Faire 1,25–10× (clamp si markup retail trop bas)", () => {
    const ctx = makeCtx();
    // Retail = ×1 → trop bas, doit être remonté à ×1.25
    ctx.markups.faireRetail = { type: "multiplier", value: 1, rounding: "none" };
    const rows = productToFaireRows(makeProduct(), ctx);
    const wholesale = rows[0]![30] as number;
    const retail = rows[0]![31] as number;
    expect(retail / wholesale).toBeGreaterThanOrEqual(1.25);
  });

  it("colonne 47 product_images = URLs séparées par espace", () => {
    const rows = productToFaireRows(
      makeProduct({
        variants: [
          makeVariant({
            imagePaths: [
              "/uploads/produits/e803/img1.webp",
              "/uploads/produits/e803/img2.webp",
            ],
          }),
        ],
      }),
      makeCtx(),
    );
    const productImages = rows[0]![46] as string;
    expect(productImages).toContain("img1.webp");
    expect(productImages).toContain("img2.webp");
    // 2 URLs → 1 espace de séparation entre elles
    expect(productImages.split(" ").length).toBe(2);
  });

  it("ajoute ?format=jpeg&minWidth=1000 sur chaque URL d'image (proxy Faire)", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    const productImages = rows[0]![46] as string;
    expect(productImages).toContain("format=jpeg");
    expect(productImages).toContain("minWidth=1000");
  });

  it("colonne 48 made_in_country = nom FR du pays", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    expect(rows[0]![47]).toBe("Chine");
  });

  it("colonne 65 on_hand_inventory = stock", () => {
    const rows = productToFaireRows(
      makeProduct({ variants: [makeVariant({ stock: 42 })] }),
      makeCtx(),
    );
    expect(rows[0]![64]).toBe(42);
  });

  it("colonne 68 tariff_code tronqué à HS6 (XXXX.XX)", () => {
    const rows = productToFaireRows(makeProduct({ hsCode: "7117.19.00" }), makeCtx());
    expect(rows[0]![67]).toBe("7117.19");
  });

  it("retombe sur les images d'une autre variante si la UNIT n'en a pas", () => {
    const rows = productToFaireRows(
      makeProduct({
        variants: [
          makeVariant({
            variantId: "u1",
            colorNames: ["Doré"],
            saleType: "UNIT",
            imagePaths: [],
          }),
          makeVariant({
            variantId: "p1",
            colorNames: ["Doré"],
            saleType: "PACK",
            packQuantity: 12,
            imagePaths: ["/uploads/produits/e803/pack-photo.webp"],
          }),
        ],
      }),
      makeCtx(),
    );
    // 1 seule ligne (la UNIT) mais l'image vient du PACK.
    expect(rows).toHaveLength(1);
    const productImages = rows[0]![46] as string;
    expect(productImages).toContain("pack-photo.webp");
  });

  it("convertit les dimensions mm → cm avec unité 'cm' (col 14)", () => {
    const rows = productToFaireRows(
      makeProduct({
        dimensionLength: 420, // 42 cm
        dimensionWidth: 30, // 3 cm
        dimensionHeight: null,
      }),
      makeCtx(),
    );
    expect(rows[0]![10]).toBe(42); // col 11 length
    expect(rows[0]![11]).toBe(3); // col 12 width
    expect(rows[0]![12]).toBe(null); // col 13 height vide
    expect(rows[0]![13]).toBe("cm"); // col 14 unit
  });

  it("ne pose pas l'unité de dimensions si aucune valeur fournie", () => {
    const rows = productToFaireRows(makeProduct(), makeCtx());
    expect(rows[0]![13]).toBe(null);
  });
});

