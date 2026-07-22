import { describe, it, expect } from "vitest";
import { comparePfsProduct, type PfsVerifyIssue } from "@/lib/pfs-verify";
import { groupIssuesByBlock } from "@/components/admin/products/PfsVerifyBadge";
import type { PfsCheckReferenceResponse, PfsVariantDetail } from "@/lib/pfs-api";

// ─── Fabriques ─────────────────────────────────────────────────────────────

type LocalProduct = Parameters<typeof comparePfsProduct>[0];

function makeLocalProduct(overrides: Partial<LocalProduct> = {}): LocalProduct {
  const base: LocalProduct = {
    id: "prod-1",
    reference: "REF001",
    name: "Bracelet Éden",
    description: "Bracelet doré fin en laiton.",
    isBestSeller: false,
    status: "ONLINE",
    pfsProductId: "pfs_1",
    dimensionLength: null,
    dimensionWidth: null,
    dimensionHeight: null,
    dimensionDiameter: null,
    dimensionCircumference: null,
    sizeDetailsTu: null,
    category: {
      name: "Bracelet",
      pfsCategoryId: "cat_bracelet",
      pfsCategoryName: "Bracelets",
      pfsGender: "WOMAN",
      pfsFamilyId: "fam_jewel",
      pfsFamilyName: "Bijoux fantaisie",
    },
    colors: [
      makeLocalVariant({
        id: "v1-rose-unit",
        colorPfsRef: "ROSE",
        colorName: "Rose",
        saleType: "UNIT",
        price: 16.5,
        stock: 28,
        weight: 0.02,
      }),
    ],
    compositions: [
      { percentage: 100, composition: { pfsCompositionRef: "LAITON", name: "Laiton" } },
    ],
    countryIsoCode: "CN",
    season: { pfsRef: "PE2026", name: "PE2026" },
  };
  return { ...base, ...overrides };
}

function makeLocalVariant(o: {
  id: string;
  colorPfsRef: string;
  colorName: string;
  colorHex?: string | null;
  saleType: "UNIT" | "PACK";
  price: number;
  stock: number;
  weight: number;
  packQuantity?: number | null;
  packLines?: LocalProduct["colors"][number]["packLines"];
  variantSizes?: LocalProduct["colors"][number]["variantSizes"];
}): LocalProduct["colors"][number] {
  return {
    id: o.id,
    pfsVariantId: null,
    unitPrice: o.price,
    weight: o.weight,
    stock: o.stock,
    saleType: o.saleType,
    packQuantity: o.packQuantity ?? null,
    variantSizes: o.variantSizes ?? [
      { size: { name: "TU", pfsSizeRef: "TU" }, quantity: 1 },
    ],
    colorId: "c-" + o.colorPfsRef,
    color: {
      id: "c-" + o.colorPfsRef,
      name: o.colorName,
      hex: o.colorHex ?? "#ec4899",
      pfsColorRef: o.colorPfsRef,
    },
    pfsColorRefOverride: null,
    packLines: o.packLines ?? [],
  };
}

function makePfsProduct(
  overrides: Partial<NonNullable<PfsCheckReferenceResponse["product"]>> = {},
): NonNullable<PfsCheckReferenceResponse["product"]> {
  return {
    id: "pfs_1",
    brand: { id: "b1", name: "BJ" },
    gender: { reference: "WOMAN" },
    family: { id: "fam_jewel", reference: "JEWEL" },
    category: { id: "cat_bracelet", reference: "BRACELET" },
    reference: "REF001",
    label: { fr: "Bracelet Éden" },
    material_composition: [
      { id: "cm1", reference: "LAITON", percentage: 100, labels: { fr: "Laiton" } },
    ],
    lining_composition: [],
    country_of_manufacture: "CN",
    description: { fr: "Bracelet doré fin en laiton." },
    status: "READY_FOR_SALE",
    default_color: "ROSE",
    images: {},
    flash_sales_discount: null,
    ...overrides,
  };
}

function makePfsVariant(o: {
  id?: string;
  type: "ITEM" | "PACK";
  colorRef: string;
  colorLabelFr?: string;
  colorHex?: string;
  price: number;
  stock: number;
  weight: number;
  isActive?: boolean;
  isStar?: boolean;
  packs?: { colorRef: string; sizes: { size: string; qty: number }[] }[];
}): PfsVariantDetail {
  const color = {
    id: 1,
    reference: o.colorRef,
    value: o.colorHex ?? "#ec4899",
    image: null,
    labels: { fr: o.colorLabelFr ?? o.colorRef },
  };
  const base: PfsVariantDetail = {
    id: o.id ?? "pv-" + o.colorRef + "-" + o.type,
    sku_suffix: null,
    type: o.type,
    custom_suffix: "",
    pieces: 1,
    price_sale: {
      unit: { value: o.price, currency: "EUR" },
      total: { value: o.price, currency: "EUR" },
    },
    price_before_discount: {
      unit: { value: o.price, currency: "EUR" },
      total: { value: o.price, currency: "EUR" },
    },
    discount: null,
    is_active: o.isActive ?? true,
    is_star: o.isStar ?? false,
    in_stock: o.stock > 0,
    stock_qty: o.stock,
    weight: o.weight,
    creation_date: null,
    product_id: "pfs_1",
    reference: "REF001",
    size_details_tu: "",
    colors: [color],
  };
  if (o.type === "ITEM") {
    base.item = { color, size: "TU" };
  } else if (o.packs) {
    base.packs = o.packs.map((p) => ({
      color: {
        ...color,
        reference: p.colorRef,
        labels: { fr: p.colorRef },
      },
      sizes: p.sizes.map((s) => ({ id: "s", size: s.size, qty: s.qty })),
    }));
  }
  return base;
}

const NO_MARKUP = { deactivateOnZeroStock: true };
const EMPTY_COLOR_MAP = new Map<string, string>();

// ─── Tests comparePfsProduct ──────────────────────────────────────────────

describe("comparePfsProduct", () => {
  it("retourne aucun écart quand tout correspond", () => {
    const local = makeLocalProduct();
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues).toEqual([]);
  });

  it("détecte un écart de nom", () => {
    const local = makeLocalProduct();
    const pfsProduct = makePfsProduct({ label: { fr: "Ancien nom" } });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const nameIssue = issues.find((i) => i.field === "name");
    expect(nameIssue).toBeDefined();
    expect(nameIssue).toMatchObject({
      scope: "product",
      pfsValue: "Ancien nom",
      expectedValue: "Bracelet Éden",
    });
  });

  it("détecte un écart de composition (ordre indépendant)", () => {
    const local = makeLocalProduct({
      compositions: [
        { percentage: 80, composition: { pfsCompositionRef: "LAITON", name: "Laiton" } },
        { percentage: 20, composition: { pfsCompositionRef: "ZIRCON", name: "Zircon" } },
      ],
    });
    const pfsProduct = makePfsProduct({
      material_composition: [
        { id: "cm1", reference: "LAITON", percentage: 100, labels: {} },
      ],
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const compo = issues.find((i) => i.field === "composition");
    expect(compo).toBeDefined();
    // "Attendu" utilise le nom local de la composition (fallback quand la
    // map PFS n'est pas fournie dans les tests) ; côté PFS on garde la REF
    // brute puisqu'aucun mapping PFS n'est câblé ici.
    expect(compo?.expectedValue).toBe("Laiton 80%, Zircon 20%");
    expect(compo?.pfsValue).toBe("LAITON 100%");
  });

  it("détecte des écarts prix + stock sur une variante", () => {
    const local = makeLocalProduct();
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 14.9, stock: 42, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues.find((i) => i.field === "price")).toMatchObject({
      colorRef: "ROSE",
      variantType: "UNIT",
      pfsValue: "14.90 €",
      expectedValue: "16.50 €",
    });
    expect(issues.find((i) => i.field === "stock")).toMatchObject({
      colorRef: "ROSE",
      variantType: "UNIT",
      pfsValue: "42",
      expectedValue: "28",
    });
  });

  it("détecte une variante en trop côté PFS", () => {
    const local = makeLocalProduct();
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
      makePfsVariant({ id: "extra", type: "ITEM", colorRef: "VERT", price: 10, stock: 5, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const extra = issues.find((i) => i.field === "extraVariant");
    expect(extra).toBeDefined();
    expect(extra).toMatchObject({ colorRef: "VERT", variantType: "UNIT" });
  });

  it("détecte une variante manquante sur PFS", () => {
    const local = makeLocalProduct({
      colors: [
        makeLocalVariant({
          id: "v-rose",
          colorPfsRef: "ROSE",
          colorName: "Rose",
          saleType: "UNIT",
          price: 16.5,
          stock: 28,
          weight: 0.02,
        }),
        makeLocalVariant({
          id: "v-bleu",
          colorPfsRef: "BLEU",
          colorName: "Bleu",
          saleType: "UNIT",
          price: 16.5,
          stock: 10,
          weight: 0.02,
        }),
      ],
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const missing = issues.find((i) => i.field === "missingVariant");
    expect(missing).toBeDefined();
    expect(missing).toMatchObject({ colorRef: "BLEU", variantType: "UNIT" });
  });

  it("détecte un changement de signature de pack", () => {
    const local = makeLocalProduct({
      colors: [
        makeLocalVariant({
          id: "v-rose-pack",
          colorPfsRef: "ROSE",
          colorName: "Rose",
          saleType: "PACK",
          price: 42,
          stock: 10,
          weight: 0.04,
          packQuantity: 3,
          variantSizes: [
            { size: { name: "TU", pfsSizeRef: "TU" }, quantity: 3 },
          ],
        }),
      ],
    });
    const pfsProduct = makePfsProduct();
    // PACK de 2 côté PFS (au lieu de 3) → signature différente
    const pfsVariants = [
      makePfsVariant({
        type: "PACK",
        colorRef: "ROSE",
        price: 14,
        stock: 10,
        weight: 0.04,
        packs: [{ colorRef: "ROSE", sizes: [{ size: "TU", qty: 2 }] }],
      }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const sig = issues.find((i) => i.field === "saleType");
    expect(sig).toBeDefined();
    expect(sig?.pfsValue).toBe("ROSE:TU:2");
    expect(sig?.expectedValue).toBe("ROSE:TU:3");
  });

  it("ne signale pas d'écart de composition si les refs diffèrent seulement en casse/espaces/accents", () => {
    // Local a stocké le libellé humain « Acier inoxydable » comme ref,
    // PFS renvoie le code technique « ACIERINOXYDABLE » — c'est la même
    // matière, on ne doit surtout pas créer un faux écart.
    const local = makeLocalProduct({
      compositions: [
        { percentage: 100, composition: { pfsCompositionRef: "Acier inoxydable", name: "Acier inoxydable" } },
      ],
    });
    const pfsProduct = makePfsProduct({
      material_composition: [
        { id: "cm1", reference: "ACIERINOXYDABLE", percentage: 100, labels: {} },
      ],
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues.find((i) => i.field === "composition")).toBeUndefined();
  });

  it("matche les variantes même si la casse/accents de la couleur diffèrent (Rose ↔ ROSE)", () => {
    // Local a « Rose » comme pfsColorRef, PFS renvoie « ROSE » — la même
    // variante. Avant normalizeColorRef, le match ratait et on obtenait un
    // extra + un missing au lieu de comparer prix/stock/poids.
    const local = makeLocalProduct({
      colors: [
        makeLocalVariant({
          id: "v1",
          colorPfsRef: "Rose",
          colorName: "Rose",
          saleType: "UNIT",
          price: 16.5,
          stock: 28,
          weight: 0.02, // 20 g
        }),
      ],
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.025 }), // 25 g
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues.find((i) => i.field === "extraVariant")).toBeUndefined();
    expect(issues.find((i) => i.field === "missingVariant")).toBeUndefined();
    // Écart de poids (0.02 kg → 0.025 kg = 5g) doit remonter et s'afficher en g.
    const weightIssue = issues.find((i) => i.field === "weight");
    expect(weightIssue).toBeDefined();
    expect(weightIssue?.pfsValue).toBe("25 g");
    expect(weightIssue?.expectedValue).toBe("20 g");
  });

  it("détecte un écart de poids de 1 g (2g vs 3g stockés en kg)", () => {
    // Cas réel PS3 : PFS renvoie 0.003, local a 0.002 → 1g de différence.
    // Une ancienne tolérance de 0.01 (kg) écrasait totalement l'écart.
    const local = makeLocalProduct({
      colors: [
        makeLocalVariant({
          id: "v1",
          colorPfsRef: "SILVER",
          colorName: "Silver",
          saleType: "UNIT",
          price: 4,
          stock: 1000,
          weight: 0.002,
        }),
      ],
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "SILVER", price: 4, stock: 1000, weight: 0.003 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const w = issues.find((i) => i.field === "weight");
    expect(w).toBeDefined();
    expect(w?.pfsValue).toBe("3 g");
    expect(w?.expectedValue).toBe("2 g");
  });

  it("détecte un écart de statut (local ONLINE, PFS ARCHIVED)", () => {
    // Cas concret : la cliente a passé le produit ONLINE côté site mais côté
    // PFS il est encore ARCHIVED (transition manquée). Doit remonter en écart.
    const local = makeLocalProduct(); // status: "ONLINE" + stock 28 sur ROSE
    const pfsProduct = makePfsProduct({ status: "ARCHIVED" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const statusIssue = issues.find((i) => i.field === "productStatus");
    expect(statusIssue).toBeDefined();
    expect(statusIssue).toMatchObject({
      scope: "product",
      pfsValue: "Archivé",
      expectedValue: "En ligne",
    });
  });

  it("ne signale pas d'écart de statut si local=OFFLINE ↔ PFS=DRAFT (mapping correct)", () => {
    const local = makeLocalProduct({ status: "OFFLINE" });
    const pfsProduct = makePfsProduct({ status: "DRAFT" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues.find((i) => i.field === "productStatus")).toBeUndefined();
  });

  it("respecte la config out-of-stock pour le statut attendu (produit ONLINE mais tout en rupture → ARCHIVED attendu)", () => {
    // Local ONLINE + toutes variantes stock=0 → attendu = ARCHIVED côté PFS
    // (config par défaut). Si PFS est READY_FOR_SALE, on doit signaler l'écart.
    const local = makeLocalProduct({
      colors: [
        makeLocalVariant({
          id: "v1",
          colorPfsRef: "ROSE",
          colorName: "Rose",
          saleType: "UNIT",
          price: 16.5,
          stock: 0,
          weight: 0.02,
        }),
      ],
    });
    const pfsProduct = makePfsProduct({ status: "READY_FOR_SALE" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 0, weight: 0.02, isActive: false }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, {
      deactivateOnZeroStock: true,
      outOfStockProductAction: "archived",
    });
    const statusIssue = issues.find((i) => i.field === "productStatus");
    expect(statusIssue).toBeDefined();
    expect(statusIssue?.expectedValue).toBe("Archivé");
    expect(statusIssue?.pfsValue).toBe("En ligne");
  });

  it("fusionne les écarts catégorie + famille en un seul écart « Catégorie » avec libellés humains", () => {
    const local = makeLocalProduct(); // pfsCategoryId=cat_bracelet, pfsCategoryName=Bracelets
    const pfsProduct = makePfsProduct({
      category: { id: "cat_collier", reference: "COLLIER" },
      family: { id: "fam_autre", reference: "AUTRE" }, // famille change aussi
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const catLabels = new Map<string, string>([
      ["cat_bracelet", "Bracelets"],
      ["cat_collier", "Colliers"],
    ]);
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, {
      ...NO_MARKUP,
      labels: { categoryLabelById: catLabels },
    });
    // Un seul écart Catégorie, aucun écart Famille séparé
    const cats = issues.filter((i) => i.field === "category");
    const fams = issues.filter((i) => i.field === "family");
    expect(cats).toHaveLength(1);
    expect(fams).toHaveLength(0);
    expect(cats[0].pfsValue).toBe("Colliers");
    expect(cats[0].expectedValue).toBe("Bracelets");
    // Le pull est bloqué (Lot C — mapping local à créer)
    expect(cats[0].pullBlocked).toBeTruthy();
    expect(cats[0].pushBlocked).toBeUndefined();
  });

  it("affiche le genre en français (Femme, Homme…) plutôt que WOMAN/MAN", () => {
    const local = makeLocalProduct({
      category: {
        name: "Bracelet",
        pfsCategoryId: "cat_bracelet",
        pfsCategoryName: "Bracelets",
        pfsGender: "WOMAN",
        pfsFamilyId: "fam_jewel",
        pfsFamilyName: "Bijoux fantaisie",
      },
    });
    const pfsProduct = makePfsProduct({ gender: { reference: "MAN" } });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const gender = issues.find((i) => i.field === "gender");
    expect(gender).toBeDefined();
    expect(gender?.pfsValue).toBe("Homme");
    expect(gender?.expectedValue).toBe("Femme");
    expect(gender?.pullBlocked).toBeTruthy();
  });

  it("affiche le pays en français via lib/countries.ts même sans map PFS fournie", () => {
    // Cas réel : l'API pfsGetCountries échoue silencieusement → labels.countryLabelByIso
    // reste vide, on ne doit pas retomber sur "CN"/"FR" bruts mais bien afficher
    // les noms français ("Chine", "France") via countryName().
    const local = makeLocalProduct({ countryIsoCode: "CN" });
    const pfsProduct = makePfsProduct({ country_of_manufacture: "FR" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const country = issues.find((i) => i.field === "country");
    expect(country?.pfsValue).toBe("France");
    expect(country?.expectedValue).toBe("Chine");
  });

  it("affiche le pays en français quand la map ISO→label est fournie", () => {
    const local = makeLocalProduct({ countryIsoCode: "CN" });
    const pfsProduct = makePfsProduct({ country_of_manufacture: "FR" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const countryLabels = new Map<string, string>([
      ["CN", "Chine"],
      ["FR", "France"],
    ]);
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, {
      ...NO_MARKUP,
      labels: { countryLabelByIso: countryLabels },
    });
    const country = issues.find((i) => i.field === "country");
    expect(country).toBeDefined();
    expect(country?.pfsValue).toBe("France");
    expect(country?.expectedValue).toBe("Chine");
    expect(country?.pullBlocked).toBeTruthy();
  });

  it("détecte un écart best-seller (STAR côté PFS mais pas chez nous)", () => {
    const local = makeLocalProduct({ isBestSeller: false });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({
        type: "ITEM",
        colorRef: "ROSE",
        price: 16.5,
        stock: 28,
        weight: 0.02,
        isStar: true,
      }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const bs = issues.find((i) => i.field === "isBestSeller");
    expect(bs).toBeDefined();
    expect(bs?.pfsValue).toBe("Oui");
    expect(bs?.expectedValue).toBe("Non");
  });
});

// ─── Tests groupIssuesByBlock ──────────────────────────────────────────────

describe("groupIssuesByBlock", () => {
  it("regroupe les variantes d'une même couleur (Unité + Pack) dans un seul bloc", () => {
    const issues: PfsVerifyIssue[] = [
      {
        scope: "color",
        field: "price",
        fieldLabel: "Prix",
        colorRef: "ROSE",
        colorName: "Rose",
        colorHex: "#ec4899",
        variantType: "UNIT",
        packQuantity: null,
        pfsValue: "14.90 €",
        expectedValue: "16.50 €",
      },
      {
        scope: "color",
        field: "stock",
        fieldLabel: "Stock",
        colorRef: "ROSE",
        colorName: "Rose",
        colorHex: "#ec4899",
        variantType: "UNIT",
        packQuantity: null,
        pfsValue: "42",
        expectedValue: "28",
      },
      {
        scope: "color",
        field: "price",
        fieldLabel: "Prix",
        colorRef: "ROSE",
        colorName: "Rose",
        colorHex: "#ec4899",
        variantType: "PACK",
        packQuantity: 3,
        pfsValue: "39.00 €",
        expectedValue: "42.00 €",
      },
    ];
    const grouped = groupIssuesByBlock(issues);
    expect(grouped.colorBlocks).toHaveLength(1);
    const rose = grouped.colorBlocks[0];
    expect(rose.colorRef).toBe("ROSE");
    // 2 variant groups : UNIT + PACK, la couleur reste unique
    expect(rose.variantGroups).toHaveLength(2);
    const unit = rose.variantGroups.find((v) => v.variantType === "UNIT")!;
    const pack = rose.variantGroups.find((v) => v.variantType === "PACK")!;
    expect(unit.issues).toHaveLength(2);
    expect(pack.issues).toHaveLength(1);
    expect(pack.packQuantity).toBe(3);
  });

  it("sépare les issues produit et les issues couleur", () => {
    const issues: PfsVerifyIssue[] = [
      {
        scope: "product",
        field: "composition",
        fieldLabel: "Composition",
        pfsValue: "LAITON 100%",
        expectedValue: "LAITON 80%, ZIRCON 20%",
      },
      {
        scope: "color",
        field: "price",
        fieldLabel: "Prix",
        colorRef: "BLEU",
        colorName: "Bleu",
        variantType: "UNIT",
        pfsValue: "10",
        expectedValue: "12",
      },
    ];
    const grouped = groupIssuesByBlock(issues);
    expect(grouped.productIssues).toHaveLength(1);
    expect(grouped.productIssues[0].field).toBe("composition");
    expect(grouped.colorBlocks).toHaveLength(1);
    expect(grouped.colorBlocks[0].colorRef).toBe("BLEU");
  });

  it("place les extras (à retirer) et missing (à ajouter) dans leur bloc couleur", () => {
    const issues: PfsVerifyIssue[] = [
      {
        scope: "color",
        field: "extraVariant",
        fieldLabel: "Variante en trop",
        colorRef: "VERT",
        colorName: "Vert",
        variantType: "UNIT",
        pfsValue: null,
        expectedValue: null,
        note: "n'existe plus",
      },
      {
        scope: "color",
        field: "missingVariant",
        fieldLabel: "Variante manquante",
        colorRef: "JAUNE",
        colorName: "Jaune",
        variantType: "UNIT",
        pfsValue: null,
        expectedValue: null,
      },
    ];
    const grouped = groupIssuesByBlock(issues);
    const vert = grouped.colorBlocks.find((b) => b.colorRef === "VERT")!;
    const jaune = grouped.colorBlocks.find((b) => b.colorRef === "JAUNE")!;
    expect(vert.extras).toHaveLength(1);
    expect(vert.missing).toHaveLength(0);
    expect(jaune.missing).toHaveLength(1);
    expect(jaune.extras).toHaveLength(0);
  });
});
