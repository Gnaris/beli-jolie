import { describe, expect, it } from "vitest";
import {
  buildProductPayloadFromBjProduct,
  DEFAULT_ANKOR_SIZE_NAME,
  type BjProductInputForBo,
} from "@/lib/ankorstore-bo/builder";
import { ANKORSTORE_TAG_IDS, ANKORSTORE_OPTION_IDS } from "@/lib/ankorstore-bo/referentials";

const pricingConfig = {
  wholesale: { type: "percent" as const, value: 0, rounding: "none" as const },
  retail: { type: "multiplier" as const, value: 3, rounding: "none" as const },
  vatRate: 20,
};

const baseColor = {
  id: "c1",
  saleType: "UNIT" as const,
  disabled: false,
  unitPrice: 5,
  packQuantity: null,
  stock: 42,
  weight: 100,
  colorName: "Rouge",
  ankorsColorNameOverride: null,
  sizeName: null,
  imageKeys: ["file-upload:abc.jpg"],
  ian: null,
  // SKU pré-résolu par le caller — le builder ne le construit plus lui-même.
  sku: "A1720_ROUGE_ABCDE",
};

const baseInput: BjProductInputForBo = {
  reference: "A1720",
  name: "Bague test",
  description: "Une jolie bague en test.",
  status: "ONLINE",
  hsCode: "71171900",
  countryIsoCode: "FR",
  isBestSeller: false,
  dimensionsText: "10x10x1",
  compositionText: "100% Acier",
  productImageKeys: ["file-upload:cover.jpg"],
  colors: [baseColor],
};

describe("buildProductPayloadFromBjProduct", () => {
  it("crée un payload valide avec 1 couleur UNIT", () => {
    const p = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    expect(p.name).toBe("Bague test");
    expect(p.hs_code).toBe("71171900");
    expect(p.brand_id).toBe(51370);
    expect(p.made_in_country_id).toBe(76); // FR
    expect(p.vat_rate).toBe(20);
    expect(p.tags).toEqual([]);
    expect(p.variants).toHaveLength(1);
    // On envoie TOUJOURS size + color (jamais uniquement color, sinon collision
    // Ankor sur les produits avec plusieurs variantes de la même couleur).
    expect(p.options).toHaveLength(2);
    expect(p.options[0].id).toBe(ANKORSTORE_OPTION_IDS.SIZE);
    expect(p.options[0].values).toEqual([DEFAULT_ANKOR_SIZE_NAME]);
    expect(p.options[1].id).toBe(ANKORSTORE_OPTION_IDS.COLOR);
    expect(p.options[1].values).toEqual(["Rouge"]);
    expect(p.variants[0].options).toEqual([
      { id: ANKORSTORE_OPTION_IDS.SIZE, name: "size", value: DEFAULT_ANKOR_SIZE_NAME },
      { id: ANKORSTORE_OPTION_IDS.COLOR, name: "color", value: "Rouge" },
    ]);
  });

  it("SKU envoyé tel quel depuis c.sku (pré-résolu par le caller)", () => {
    const p = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    expect(p.variants[0].sku).toBe("A1720_ROUGE_ABCDE");
  });

  it("throw si c.sku manquant (le caller doit avoir pré-résolu)", () => {
    expect(() =>
      buildProductPayloadFromBjProduct(
        { ...baseInput, colors: [{ ...baseColor, sku: "" }] },
        { brandId: 51370, pricingConfig }
      )
    ).toThrow(/SKU manquant/i);
  });

  it("BestSeller ajoute le tag 8", () => {
    const p = buildProductPayloadFromBjProduct(
      { ...baseInput, isBestSeller: true },
      { brandId: 51370, pricingConfig }
    );
    expect(p.tags).toEqual([ANKORSTORE_TAG_IDS.BESTSELLER]);
  });

  it("Prix en centimes : wholesale 5€ → 500 centimes, retail 3× → 1500 centimes", () => {
    const p = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    expect(p.variants[0].price.original_wholesale_price.amount).toBe(500);
    expect(p.variants[0].price.retail_price.amount).toBe(1500);
  });

  it("Stock envoyé tel quel peu importe le statut BJ (nouveau comportement)", () => {
    const online = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    const offline = buildProductPayloadFromBjProduct(
      { ...baseInput, status: "OFFLINE" },
      { brandId: 51370, pricingConfig }
    );
    const archived = buildProductPayloadFromBjProduct(
      { ...baseInput, status: "ARCHIVED" },
      { brandId: 51370, pricingConfig }
    );
    expect(online.variants[0].stock.stock_quantity).toBe(42);
    expect(offline.variants[0].stock.stock_quantity).toBe(42);
    expect(archived.variants[0].stock.stock_quantity).toBe(42);
  });

  it("inventory_policy toujours 'deny' (refuse commande si rupture stock)", () => {
    const p = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    expect(p.variants[0].stock.inventory_policy).toBe("deny");
  });

  it("categories vide (Ankor auto-classifie par nom/description)", () => {
    const p = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    expect(p.categories).toEqual([]);
  });

  it("weight envoyé si > 0", () => {
    const p = buildProductPayloadFromBjProduct(baseInput, {
      brandId: 51370,
      pricingConfig,
    });
    expect(p.variants[0].shape_properties.weight).toBe(100);
    expect(p.variants[0].shape_properties.weight_unit).toBe("g");
  });

  it("weight null si 0 ou absent", () => {
    const p = buildProductPayloadFromBjProduct(
      { ...baseInput, colors: [{ ...baseColor, weight: 0 }] },
      { brandId: 51370, pricingConfig }
    );
    expect(p.variants[0].shape_properties.weight).toBeNull();
    expect(p.variants[0].shape_properties.weight_unit).toBeNull();
  });

  it("Ignore les variantes disabled", () => {
    const p = buildProductPayloadFromBjProduct(
      {
        ...baseInput,
        colors: [
          baseColor,
          {
            ...baseColor,
            id: "c2",
            colorName: "Bleu",
            disabled: true,
            imageKeys: [],
            sku: "A1720_BLEU_XYZAB",
          },
        ],
      },
      { brandId: 51370, pricingConfig }
    );
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0].sku).toBe("A1720_ROUGE_ABCDE");
  });

  it("Throw si aucune couleur UNIT active", () => {
    expect(() =>
      buildProductPayloadFromBjProduct(
        { ...baseInput, colors: [{ ...baseColor, disabled: true }] },
        { brandId: 51370, pricingConfig }
      )
    ).toThrow(/aucune variante unit active/i);
  });

  it("Utilise ankorsColorNameOverride si présent (option value uniquement — SKU vient de c.sku)", () => {
    const p = buildProductPayloadFromBjProduct(
      {
        ...baseInput,
        colors: [
          {
            ...baseColor,
            ankorsColorNameOverride: "Bordeaux",
            sku: "A1720_BORDEAUX_XYZAB",
          },
        ],
      },
      { brandId: 51370, pricingConfig }
    );
    // options[0] = size, options[1] = color depuis la refonte multi-taille.
    expect(p.options[1].values).toEqual(["Bordeaux"]);
    expect(p.variants[0].sku).toBe("A1720_BORDEAUX_XYZAB");
  });

  it("Envoie sizeName BJ tel quel + dédoublonne les tailles au niveau produit", () => {
    const p = buildProductPayloadFromBjProduct(
      {
        ...baseInput,
        colors: [
          { ...baseColor, sizeName: "S/M", sku: "A1720_NOIR_SM01" },
          {
            ...baseColor,
            id: "c2",
            sizeName: "M/L",
            sku: "A1720_NOIR_ML01",
          },
          {
            ...baseColor,
            id: "c3",
            sizeName: "L/XL",
            sku: "A1720_NOIR_LX01",
          },
        ],
      },
      { brandId: 51370, pricingConfig }
    );
    expect(p.options[0].values).toEqual(["S/M", "M/L", "L/XL"]);
    expect(p.variants[0].options[0]).toEqual({
      id: ANKORSTORE_OPTION_IDS.SIZE,
      name: "size",
      value: "S/M",
    });
    expect(p.variants[1].options[0].value).toBe("M/L");
    expect(p.variants[2].options[0].value).toBe("L/XL");
  });

  it("Plusieurs couleurs sur la même taille : options.values dédoublonnées", () => {
    const p = buildProductPayloadFromBjProduct(
      {
        ...baseInput,
        colors: [
          { ...baseColor, colorName: "Rouge", sizeName: "S", sku: "A1720_ROUGE_S001" },
          {
            ...baseColor,
            id: "c2",
            colorName: "Bleu",
            sizeName: "S",
            sku: "A1720_BLEU_S001",
          },
        ],
      },
      { brandId: 51370, pricingConfig }
    );
    expect(p.options[0].values).toEqual(["S"]); // une seule taille
    expect(p.options[1].values).toEqual(["Rouge", "Bleu"]);
  });

  it("sizeName vide ou espaces → fallback DEFAULT_ANKOR_SIZE_NAME", () => {
    const p = buildProductPayloadFromBjProduct(
      { ...baseInput, colors: [{ ...baseColor, sizeName: "   " }] },
      { brandId: 51370, pricingConfig }
    );
    expect(p.variants[0].options[0].value).toBe(DEFAULT_ANKOR_SIZE_NAME);
  });

  it("Pays Chine (CN) → id 46", () => {
    const p = buildProductPayloadFromBjProduct(
      { ...baseInput, countryIsoCode: "CN" },
      { brandId: 51370, pricingConfig }
    );
    expect(p.made_in_country_id).toBe(46);
  });

  it("Pays inconnu → fallback CN 46", () => {
    const p = buildProductPayloadFromBjProduct(
      { ...baseInput, countryIsoCode: "ZZ" },
      { brandId: 51370, pricingConfig }
    );
    expect(p.made_in_country_id).toBe(46);
  });
});
