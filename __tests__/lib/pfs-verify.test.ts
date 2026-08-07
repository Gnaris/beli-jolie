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
  disabled?: boolean;
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
    disabled: o.disabled ?? false,
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

const NO_MARKUP = {};
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

  it("compo BJ orpheline uniquement (PFS = source de vérité) → écart pullable, pas de blocage mapping", () => {
    // Local a 2 compos (Laiton + Zircon), PFS n'a que Laiton. Chaque matière
    // PFS trouve son équivalent local, mais Zircon reste orpheline côté BJ.
    // Depuis 2026-08-07, on ne bloque plus : le pull « Corriger depuis PFS »
    // remplacera la compo par celle de PFS (Laiton seul) et retirera Zircon.
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
    // Écart pullable normal : les 2 valeurs sont affichées côte à côte, sans
    // blocage mapping et sans pullBlocked (le pull retire les extras).
    expect(compo?.pfsValue).toBe("LAITON 100%");
    expect(compo?.expectedValue).toContain("Laiton");
    expect(compo?.expectedValue).toContain("Zircon");
    expect(compo?.blockingMappingIssue).toBeUndefined();
    expect(compo?.pullBlocked).toBeUndefined();
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

  it("réconcilie « Coton » ↔ « COTTON » via le libellé FR PFS et déclenche l'auto-guérison", () => {
    // Reproduit le bug production : local a stocké « Coton » comme
    // pfsCompositionRef (au lieu de « COTTON » — bug d'import historique).
    // La compo BJ nommée « Coton » doit être réconciliée avec la matière
    // PFS « COTTON » via le libellé FR "Coton", sans faux positif et en
    // proposant une auto-guérison de `pfsCompositionRef`.
    const local = makeLocalProduct({
      compositions: [
        { percentage: 100, composition: { id: "c-coton", pfsCompositionRef: "Coton", name: "Coton" } },
      ],
    });
    const pfsProduct = makePfsProduct({
      material_composition: [
        { id: "cm1", reference: "COTTON", percentage: 100, labels: { fr: "Coton" } },
      ],
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const heals: Array<{ localCompositionId: string; newPfsRef: string }> = [];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, {
      onCompositionAutoHeal: (h) => heals.push({ localCompositionId: h.localCompositionId, newPfsRef: h.newPfsRef }),
    });
    expect(issues.find((i) => i.field === "composition")).toBeUndefined();
    expect(heals).toEqual([{ localCompositionId: "c-coton", newPfsRef: "COTTON" }]);
  });

  it("bloque quand PFS renvoie une matière absente du catalogue BJ (création manuelle exigée)", () => {
    // PFS a « CACHEMIRE », local n'a que « Coton ». Aucune auto-création :
    // l'admin doit créer la composition manuellement dans Paramètres.
    const local = makeLocalProduct({
      compositions: [
        { percentage: 100, composition: { id: "c-coton", pfsCompositionRef: "COTTON", name: "Coton" } },
      ],
    });
    const pfsProduct = makePfsProduct({
      material_composition: [
        { id: "cm1", reference: "COTTON", percentage: 80, labels: { fr: "Coton" } },
        { id: "cm2", reference: "CACHEMIRE", percentage: 20, labels: { fr: "Cachemire" } },
      ],
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const heals: unknown[] = [];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, {
      onCompositionAutoHeal: (h) => heals.push(h),
    });
    const compoIssue = issues.find((i) => i.field === "composition");
    expect(compoIssue).toBeDefined();
    expect(compoIssue?.blockingMappingIssue).toContain("Cachemire");
    expect(compoIssue?.blockingMappingIssue).toContain("créez-la");
    // Pas de guérison automatique (l'écart existe pour de vrai).
    expect(heals).toEqual([]);
  });

  it("ne bloque pas quand PFS est vide et BJ a plusieurs compos (pull retirera tout)", () => {
    // Scénario reporté 2026-08-07 : PFS ne renvoie aucune composition (bug
    // ou fiche mal remplie côté PFS) mais BJ a Élasthanne + Coton, tous deux
    // avec leur mapping PFS. Avant, on affichait « MAPPING REQUIS » et on
    // demandait de renseigner la référence PFS — trompeur (les mappings sont
    // bons). Maintenant : écart pullable normal, le pull remplacera la compo
    // BJ par celle de PFS (vide).
    const local = makeLocalProduct({
      compositions: [
        { percentage: 95, composition: { id: "c-coton", pfsCompositionRef: "COTTON", name: "Coton" } },
        { percentage: 5, composition: { id: "c-elast", pfsCompositionRef: "ELASTHANNE", name: "Élasthanne" } },
      ],
    });
    const pfsProduct = makePfsProduct({ material_composition: [] });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const compoIssue = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP)
      .find((i) => i.field === "composition");
    expect(compoIssue).toBeDefined();
    expect(compoIssue?.blockingMappingIssue).toBeUndefined();
    expect(compoIssue?.pullBlocked).toBeUndefined();
    expect(compoIssue?.pfsValue).toBe("(vide)");
    expect(compoIssue?.expectedValue).toContain("Coton");
    expect(compoIssue?.expectedValue).toContain("Élasthanne");
  });

  it("bloque quand PFS a une matière inconnue ET BJ a des orphelines (mentionne les 2)", () => {
    // PFS a « CACHEMIRE » (inconnu de BJ) + « COTON ». BJ a « Coton » +
    // « Laine » (Laine sans équivalent PFS). Cachemire déclenche le blocage
    // (création requise), Laine est mentionnée à titre d'info seulement.
    const local = makeLocalProduct({
      compositions: [
        { percentage: 80, composition: { id: "c-coton", pfsCompositionRef: "COTTON", name: "Coton" } },
        { percentage: 20, composition: { id: "c-laine", pfsCompositionRef: "LAINE", name: "Laine" } },
      ],
    });
    const pfsProduct = makePfsProduct({
      material_composition: [
        { id: "cm1", reference: "COTTON", percentage: 80, labels: { fr: "Coton" } },
        { id: "cm2", reference: "CACHEMIRE", percentage: 20, labels: { fr: "Cachemire" } },
      ],
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const compoIssue = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP)
      .find((i) => i.field === "composition");
    expect(compoIssue?.blockingMappingIssue).toContain("Cachemire");
    expect(compoIssue?.blockingMappingIssue).toContain("créez-la");
    expect(compoIssue?.expectedValue).toContain("Manque côté BJ : Cachemire");
    expect(compoIssue?.expectedValue).toContain("En trop côté BJ : Laine");
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

  it("ne signale pas d'écart isActive quand disabled=false même si stock=0 (align push semantics)", () => {
    // Bug 2026-07-24 : quand la config `pfs_out_of_stock_deactivate_variant`
    // était true, une variante disabled=false + stock=0 générait un écart
    // isActive (expected=false calculé depuis stock=0) que le pull ne pouvait
    // pas résoudre (pull écrit disabled=false, valeur déjà présente). Le
    // compare est désormais aligné sur le push (`enable: !disabled`).
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
          disabled: false,
        }),
      ],
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 0, weight: 0.02, isActive: true }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues.find((i) => i.field === "isActive")).toBeUndefined();
  });

  it("signale un écart isActive uniquement sur le flag disabled (pull effectif)", () => {
    // disabled=true localement, PFS is_active=true → écart, pull doit fixer.
    const local = makeLocalProduct({
      colors: [
        makeLocalVariant({
          id: "v1",
          colorPfsRef: "ROSE",
          colorName: "Rose",
          saleType: "UNIT",
          price: 16.5,
          stock: 10,
          weight: 0.02,
          disabled: true,
        }),
      ],
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 10, weight: 0.02, isActive: true }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const iss = issues.find((i) => i.field === "isActive");
    expect(iss).toBeDefined();
    expect(iss?.pfsValue).toBe("Oui");
    expect(iss?.expectedValue).toBe("Non");
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

  it("PFS NEW s'affiche comme « Archivé » (pas « Nouveau ») quand local=ONLINE", () => {
    // Un produit PFS en NEW = créé mais jamais activé (invisible via
    // listProducts, affiché « brouillon » dans l'UI PFS). Sémantiquement
    // équivalent à ARCHIVED chez nous → le modal doit afficher « Archivé »
    // et le pull le mettra bien en ARCHIVED côté local.
    const local = makeLocalProduct(); // status ONLINE + stock 28
    const pfsProduct = makePfsProduct({ status: "NEW" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const statusIssue = issues.find((i) => i.field === "productStatus");
    expect(statusIssue).toBeDefined();
    expect(statusIssue?.pfsValue).toBe("Archivé");
    expect(statusIssue?.expectedValue).toBe("En ligne");
  });

  it("ne signale pas d'écart de statut si local=ARCHIVED ↔ PFS=NEW (équivalent sémantique)", () => {
    // Cas concret : la cliente a passé le produit en ARCHIVED côté site, et
    // côté PFS il est en NEW (produit créé mais jamais activé, affiché
    // « brouillon » côté UI PFS). Aucun écart bidon à afficher.
    const local = makeLocalProduct({ status: "ARCHIVED" });
    const pfsProduct = makePfsProduct({ status: "NEW" });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    expect(issues.find((i) => i.field === "productStatus")).toBeUndefined();
  });

  it("ne signale pas d'écart statut quand local=ONLINE ↔ PFS=READY_FOR_SALE même si toutes les variantes locales sont à stock=0", () => {
    // Bug reporté 2026-08-07 sur 13764-3 : depuis 2026-08-07, l'audit compare
    // strictement `local.status` ↔ `pfs.status` sans facteur rupture. Sinon
    // après un pull qui aligne BJ sur PFS (BJ passe OFFLINE→ONLINE), la carte
    // productStatus persistait tant que les stocks locaux restaient à 0 →
    // cliente pense que le pull n'a rien fait. L'auto-archive `allZero`
    // continue de vivre côté PUSH (pfs-update / pfs-publish).
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
      outOfStockProductAction: "archived",
    });
    expect(issues.find((i) => i.field === "productStatus")).toBeUndefined();
  });

  it("signale toujours un écart quand local=OFFLINE ↔ PFS=READY_FOR_SALE (le pull ramènera BJ en ONLINE)", () => {
    // Scénario 13764-3 : local OFFLINE, PFS en ligne. On veut voir l'écart
    // pour que la cliente puisse cliquer « Corriger depuis PFS ». Après pull
    // BJ passe ONLINE ; le test précédent garantit que la carte disparaît
    // même si les stocks BJ restent à 0.
    const local = makeLocalProduct({
      status: "OFFLINE",
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
    const statusIssue = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, {
      outOfStockProductAction: "archived",
    }).find((i) => i.field === "productStatus");
    expect(statusIssue).toBeDefined();
    expect(statusIssue?.pfsValue).toBe("En ligne");
    expect(statusIssue?.expectedValue).toBe("Hors ligne (brouillon)");
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

describe("comparePfsProduct — mapping BJ manquant (blockingMappingIssue)", () => {
  it("pose blockingMappingIssue quand la catégorie BJ n'a pas de pfsCategoryId", () => {
    const local = makeLocalProduct({
      category: {
        name: "Bracelet",
        pfsCategoryId: null,
        pfsCategoryName: null,
        pfsGender: "WOMAN",
        pfsFamilyId: null,
        pfsFamilyName: null,
      },
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const catIssue = issues.find((i) => i.field === "category");
    expect(catIssue).toBeDefined();
    expect(catIssue?.blockingMappingIssue).toContain("Bracelet");
    expect(catIssue?.blockingMappingIssue).toContain("relancez l'audit");
    expect(catIssue?.pullBlocked).toBeDefined();
  });

  it("pose blockingMappingIssue quand une composition PFS est absente du catalogue BJ (compo locale sans mapping mentionnée en info)", () => {
    // BJ a « Fibre spéciale » sans pfsCompositionRef, PFS renvoie « Laiton ».
    // Le blocage principal = créer Laiton dans le catalogue BJ. « Fibre
    // spéciale » est mentionnée en `expectedValue` à titre d'info car elle
    // sera retirée par le pull.
    const local = makeLocalProduct({
      compositions: [
        { percentage: 100, composition: { pfsCompositionRef: null, name: "Fibre spéciale" } },
      ],
    });
    const pfsProduct = makePfsProduct();
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const compoIssue = issues.find((i) => i.field === "composition");
    expect(compoIssue).toBeDefined();
    expect(compoIssue?.blockingMappingIssue).toContain("Laiton");
    expect(compoIssue?.blockingMappingIssue).toContain("créez-la");
    expect(compoIssue?.blockingMappingIssue).toContain("relancez l'audit");
    expect(compoIssue?.expectedValue).toContain("Fibre spéciale");
  });

  it("ne pose PAS blockingMappingIssue quand tous les mappings existent (écart de valeur normal)", () => {
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
    const pfsProduct = makePfsProduct({
      // PFS a une autre catégorie que BJ (les 2 sont mappés mais divergent)
      category: { id: "cat_collier", reference: "COLLIER" },
    });
    const pfsVariants = [
      makePfsVariant({ type: "ITEM", colorRef: "ROSE", price: 16.5, stock: 28, weight: 0.02 }),
    ];
    const issues = comparePfsProduct(local, pfsProduct, pfsVariants, EMPTY_COLOR_MAP, NO_MARKUP);
    const catIssue = issues.find((i) => i.field === "category");
    expect(catIssue).toBeDefined();
    expect(catIssue?.blockingMappingIssue).toBeUndefined();
    // pullBlocked reste posé (Lot C) mais pas de mapping missing.
    expect(catIssue?.pullBlocked).toBeDefined();
  });
});
