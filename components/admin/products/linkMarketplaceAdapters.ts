/**
 * Types canoniques + dispatcher pour le modal unifié `LinkMarketplaceModal`.
 *
 * Chaque marketplace (PFS, Ankorstore, eFashion, Faire) a sa propre paire de
 * server actions (preview + link) avec des shapes différents. Ce module fait
 * le pont : on normalise en `LinkPreview` / `LinkCandidate` / `LinkLocalColor`,
 * et le composant UI reste marketplace-agnostic.
 */

import {
  previewPfsMatchByReference,
  linkPfsProductManually,
  type PfsLinkPreview,
} from "@/app/actions/admin/pfs";
import { searchAndPreviewAnkorstoreByQuery } from "@/app/actions/admin/ankorstore-search";
import { linkAnkorstoreProductWithMapping } from "@/app/actions/admin/ankorstore";
import {
  previewEfashionMatchByReference,
  linkEfashionProductManually,
} from "@/app/actions/admin/efashion";
import {
  previewFaireMatchBySku,
  linkFaireProductManually,
} from "@/app/actions/admin/faire";

// ─── Types canoniques ───────────────────────────────────────────────────────

export type Marketplace = "pfs" | "ankorstore" | "efashion" | "faire";

export interface LinkLocalColor {
  productColorId: string;
  colorId: string;
  name: string;
  hex: string | null;
  patternImage: string | null;
  productImage: string | null;
  saleType: "UNIT" | "PACK";
  sizes: string[];
  unitPrice: number;
  packQuantity: number | null;
  stock: number;
  /** null si non exposé par le marketplace / le modèle */
  weightKg: number | null;
}

export interface LinkCandidate {
  /** ID variante marketplace (string opaque). */
  id: string;
  type: "UNIT" | "PACK";
  colorName: string;
  colorHex: string | null;
  colorImage: string | null;
  sizeLabel: string;
  /** Tailles réelles d'un PACK (["S","M","L"]). Vide pour UNIT. */
  packSizes: string[];
  packQuantity: number | null;
  priceUnit: number;
  priceTotal: number;
  stockQty: number;
  weightKg: number | null;
  isActive: boolean;
  imageUrl: string | null;
  suggestedLocalColorId: string | null;
  /** Champ opaque utilisé au moment du link() pour reconstruire le payload attendu par le server action. */
  extra?: Record<string, unknown>;
}

export interface LinkPreview {
  marketplace: Marketplace;
  productId: string;
  productName: string;
  reference: string;
  searchQuery: string;
  marketplaceProductId: string | null;
  marketplaceProductName: string | null;
  marketplaceProductImage: string | null;
  localColors: LinkLocalColor[];
  candidates: LinkCandidate[];
  existingLinks: Record<string, string>;
  alreadyLinked: boolean;
  /** Attributs bloquants à compléter avant liaison (eFashion). Vide sinon. */
  missingAttributes: string[];
  /** Données propres à un marketplace utilisées au link() (ex: brand PFS, referenceBase eFashion). */
  extras: Record<string, unknown>;
}

export interface LinkResult {
  success: boolean;
  error?: string;
  linked?: number;
  syncWarning?: string;
  /** Couleurs BJ orphelines créées côté marketplace (avec upload photo). */
  autoCreatedOnMarketplace?: number;
  /** Variantes marketplace orphelines supprimées à la liaison. */
  deletedOnMarketplace?: number;
  /** Variantes marketplace orphelines importées en tant que ProductColor BJ liée. */
  importedFromMarketplace?: number;
}

/** Intentions explicites de l'admin pour les couleurs non-mappées (résolues à l'étape 3/4).
 *  - `colorsToCreate` : productColorId des couleurs BJ à créer côté marketplace (photo envoyée).
 *  - `orphansToDelete` : candidate.id des variantes marketplace à supprimer.
 *  - `orphansToImport` : candidate.id des variantes marketplace à créer en tant que ProductColor BJ + lier.
 *  Chaque orpheline marketplace DOIT être soit dans orphansToDelete soit dans orphansToImport
 *  (validation UI bloquante à l'étape 4). Les 2 tableaux sont disjoints.
 */
export interface LinkIntents {
  colorsToCreate: string[];
  orphansToDelete: string[];
  orphansToImport: string[];
}

export const EMPTY_LINK_INTENTS: LinkIntents = {
  colorsToCreate: [],
  orphansToDelete: [],
  orphansToImport: [],
};

// ─── Métadonnées UI par marketplace ─────────────────────────────────────────

export interface MarketplaceMeta {
  key: Marketplace;
  name: string;
  full: string;
  initial: string;
  cls: "pfs" | "ank" | "efa" | "fai";
  searchLabel: string;
  searchHelp: string;
  searchPlaceholder: string;
  syncsAtLink: boolean;
  /** PFS uniquement — les 3 autres ne connaissent que UNIT. */
  supportsPackType: boolean;
  markupKey: "pfs" | "efashion" | "ankorstoreRetail" | "faireWholesale";
}

export const MARKETPLACE_META: Record<Marketplace, MarketplaceMeta> = {
  pfs: {
    key: "pfs",
    name: "PFS",
    full: "PFS — Paris Fashion Shops",
    initial: "P",
    cls: "pfs",
    searchLabel: "Référence PFS",
    searchHelp:
      "Tape la référence PFS. C'est le code affiché en haut de la fiche produit dans PFS Backoffice.",
    searchPlaceholder: "Ex : A2415",
    syncsAtLink: true,
    supportsPackType: true,
    markupKey: "pfs",
  },
  ankorstore: {
    key: "ankorstore",
    name: "Ankorstore",
    full: "Ankorstore",
    initial: "A",
    cls: "ank",
    searchLabel: "Recherche dans le catalogue Ankorstore",
    searchHelp:
      "Cherche par nom, référence ou SKU. Si rien ne remonte, c'est que la fiche n'existe pas encore côté Ankorstore.",
    searchPlaceholder: "Nom, référence ou SKU…",
    syncsAtLink: true,
    supportsPackType: false,
    markupKey: "ankorstoreRetail",
  },
  efashion: {
    key: "efashion",
    name: "eFashion",
    full: "eFashion Paris",
    initial: "E",
    cls: "efa",
    searchLabel: "Référence de base eFashion",
    searchHelp:
      "La référence sans le suffixe couleur (ex : A2415, pas A2415-GOLD).",
    searchPlaceholder: "Ex : A2415",
    syncsAtLink: true,
    supportsPackType: false,
    markupKey: "efashion",
  },
  faire: {
    key: "faire",
    name: "Faire",
    full: "Faire (marketplace US/EU)",
    initial: "F",
    cls: "fai",
    searchLabel: "SKU Faire du produit",
    searchHelp:
      "Le SKU renseigné chez Faire (souvent le même que ta référence Beli & Jolie).",
    searchPlaceholder: "Ex : F137",
    syncsAtLink: true,
    supportsPackType: false,
    markupKey: "faireWholesale",
  },
};

// ─── Dispatch : preview ─────────────────────────────────────────────────────

export async function fetchLinkPreview(
  marketplace: Marketplace,
  productId: string,
  query: string,
): Promise<{ success: true; data: LinkPreview } | { success: false; error: string }> {
  if (marketplace === "pfs") {
    const res = await previewPfsMatchByReference(productId, query);
    if (!res.success) return res;
    return { success: true, data: normalizePfs(res.data) };
  }
  if (marketplace === "ankorstore") {
    const res = await searchAndPreviewAnkorstoreByQuery(productId, query);
    if (!res.success) return res;
    return { success: true, data: normalizeAnkorstore(productId, query, res.data) };
  }
  if (marketplace === "efashion") {
    const res = await previewEfashionMatchByReference(productId, query);
    if (!res.success) return res;
    return { success: true, data: normalizeEfashion(res.data) };
  }
  // faire
  const res = await previewFaireMatchBySku(productId, query);
  if (!res.success) return res;
  return { success: true, data: normalizeFaire(res.data) };
}

// ─── Dispatch : link ────────────────────────────────────────────────────────

/** `mapping` : { productColorId → candidate.id }
 *  `intents` : couleurs BJ à créer côté marketplace + variantes marketplace à supprimer.
 *  Si `intents.colorsToCreate` est vide **et** l'admin n'a mappé aucune orpheline BJ, la sync
 *  post-liaison ne créera rien côté marketplace (comportement opt-in). Si des ids sont fournis,
 *  le worker déclenche `updateProductInPlace({ forceFullSync: true })` pour matérialiser.
 */
export async function executeLink(
  preview: LinkPreview,
  mapping: Record<string, string>,
  intents: LinkIntents = EMPTY_LINK_INTENTS,
): Promise<LinkResult> {
  if (!preview.marketplaceProductId) {
    return { success: false, error: "Aucun produit marketplace sélectionné." };
  }
  const entries = Object.entries(mapping).filter(([, cid]) => Boolean(cid));
  if (entries.length === 0 && intents.colorsToCreate.length === 0) {
    return { success: false, error: "Aucune couleur liée." };
  }

  if (preview.marketplace === "pfs") {
    const links = entries.map(([productColorId, pfsVariantId]) => {
      const cand = preview.candidates.find((c) => c.id === pfsVariantId);
      return {
        productColorId,
        pfsVariantId,
        pfsColorRef: (cand?.extra?.pfsColorRef as string | undefined) ?? undefined,
      };
    });
    const brand =
      (preview.extras?.brand as { id: string | null; name: string | null } | undefined) ?? {
        id: null,
        name: null,
      };
    return linkPfsProductManually(
      preview.productId,
      preview.marketplaceProductId,
      brand,
      links,
      {
        colorsToCreate: intents.colorsToCreate,
        orphansToDelete: intents.orphansToDelete,
        orphansToImport: intents.orphansToImport,
      },
    );
  }

  if (preview.marketplace === "ankorstore") {
    const links = entries.map(([localColorId, ankorstoreVariantId]) => ({
      ankorstoreVariantId,
      localColorId,
    }));
    return linkAnkorstoreProductWithMapping(
      preview.productId,
      preview.marketplaceProductId,
      links,
      {
        colorsToCreate: intents.colorsToCreate,
        orphansToDelete: intents.orphansToDelete,
        orphansToImport: intents.orphansToImport,
      },
    );
  }

  if (preview.marketplace === "efashion") {
    const links = entries.map(([localColorId, candidateKey]) => {
      const cand = preview.candidates.find((c) => c.id === candidateKey);
      const efashionProductId = (cand?.extra?.efashionProductId as number | undefined) ?? 0;
      const efashionColorId = cand?.extra?.efashionColorId as number | undefined;
      return { localColorId, efashionProductId, efashionColorId };
    });
    const referenceBase = (preview.extras?.referenceBase as string | undefined) ?? preview.searchQuery;
    // Traduction candidate.id "efProductId:efColorId" → efashionProductId numérique
    const orphansEfashionDelete = intents.orphansToDelete
      .map((cid) => {
        const cand = preview.candidates.find((c) => c.id === cid);
        return cand?.extra?.efashionProductId as number | undefined;
      })
      .filter((n): n is number => typeof n === "number" && n > 0);
    const orphansEfashionImport = intents.orphansToImport
      .map((cid) => {
        const cand = preview.candidates.find((c) => c.id === cid);
        return cand?.extra?.efashionProductId as number | undefined;
      })
      .filter((n): n is number => typeof n === "number" && n > 0);
    const res = await linkEfashionProductManually(
      preview.productId,
      referenceBase,
      links,
      {
        colorsToCreate: intents.colorsToCreate,
        orphansToDelete: orphansEfashionDelete,
        orphansToImport: orphansEfashionImport,
      },
    );
    return {
      ...res,
      autoCreatedOnMarketplace: res.autoCreatedOnEfashion,
      deletedOnMarketplace: res.deletedOnMarketplace,
      importedFromMarketplace: res.importedFromMarketplace,
    };
  }

  // faire
  const links = entries.map(([productColorId, faireVariantId]) => ({
    productColorId,
    faireVariantId,
  }));
  const faireRes = await linkFaireProductManually(
    preview.productId,
    preview.marketplaceProductId,
    links,
    {
      colorsToCreate: intents.colorsToCreate,
      orphansToDelete: intents.orphansToDelete,
      orphansToImport: intents.orphansToImport,
    },
  );
  return faireRes;
}

// ─── Normalisation par marketplace ──────────────────────────────────────────

function normalizePfs(p: PfsLinkPreview): LinkPreview {
  return {
    marketplace: "pfs",
    productId: p.productId,
    productName: p.productName,
    reference: p.reference,
    searchQuery: p.pfsReference,
    marketplaceProductId: p.pfsProductId,
    marketplaceProductName: p.pfsProductName,
    marketplaceProductImage: p.pfsProductImage,
    localColors: p.localColors.map((c) => ({
      productColorId: c.productColorId,
      colorId: c.colorId,
      name: c.name,
      hex: c.hex,
      patternImage: c.patternImage,
      productImage: c.productImage,
      saleType: c.saleType,
      sizes: c.sizes,
      unitPrice: c.unitPrice,
      packQuantity: c.packQuantity,
      stock: c.stock,
      weightKg: c.weightKg,
    })),
    candidates: p.candidates.map((c) => ({
      id: c.pfsVariantId,
      type: c.type === "ITEM" ? "UNIT" : "PACK",
      colorName: c.pfsColorName,
      colorHex: c.pfsColorHex,
      colorImage: c.pfsColorImage,
      sizeLabel: c.sizeLabel,
      packSizes: c.packSizes,
      packQuantity: c.packQuantity,
      priceUnit: c.priceUnit,
      priceTotal: c.priceTotal,
      stockQty: c.stockQty,
      weightKg: c.weightKg,
      isActive: c.isActive,
      imageUrl: c.imageUrl,
      suggestedLocalColorId: c.suggestedLocalColorId,
      extra: { pfsColorRef: c.pfsColorRef },
    })),
    existingLinks: p.existingLinks,
    alreadyLinked: p.alreadyLinked,
    missingAttributes: [],
    extras: { brand: { id: p.pfsBrandId, name: p.pfsBrandName } },
  };
}

/** Ankorstore ne renvoie pas les tailles BJ ni le weight variante — on complète avec des valeurs neutres. */
type AkPreview = Awaited<
  ReturnType<typeof searchAndPreviewAnkorstoreByQuery>
> extends infer T
  ? T extends { success: true; data: infer D }
    ? D
    : never
  : never;

function normalizeAnkorstore(productId: string, query: string, p: AkPreview): LinkPreview {
  const existingLinks: Record<string, string> = {};
  for (const c of p.localColors) {
    if (c.existingAnkorstoreVariantId) {
      existingLinks[c.productColorId] = c.existingAnkorstoreVariantId;
    }
  }
  return {
    marketplace: "ankorstore",
    productId,
    productName: "",
    reference: query,
    searchQuery: query,
    marketplaceProductId: p.ankorstoreProduct.id,
    marketplaceProductName: p.ankorstoreProduct.name,
    marketplaceProductImage: p.ankorstoreProduct.mainImage,
    localColors: p.localColors.map((c) => ({
      productColorId: c.productColorId,
      colorId: c.colorId,
      name: c.name,
      hex: c.hex,
      patternImage: c.patternImage,
      productImage: c.productImage,
      saleType: "UNIT",
      sizes: c.sizeName ? [c.sizeName] : [],
      unitPrice: 0,
      packQuantity: null,
      stock: 0,
      weightKg: c.weightKg,
    })),
    candidates: p.variants.map((v) => ({
      id: v.ankorstoreVariantId,
      type: "UNIT",
      colorName: v.colorOption ?? v.sku ?? "—",
      colorHex: null,
      colorImage: null,
      sizeLabel: v.sizeOption ?? "TU",
      packSizes: [],
      packQuantity: null,
      priceUnit: v.wholesalePrice,
      priceTotal: v.wholesalePrice,
      stockQty: v.stockQuantity,
      weightKg: v.weightKg > 0 ? v.weightKg : null,
      isActive: true,
      imageUrl: v.imageUrl,
      suggestedLocalColorId: v.suggestedLocalColorId,
    })),
    existingLinks,
    alreadyLinked: p.localColors.some((c) => c.isAlreadyLinked),
    missingAttributes: [],
    extras: {},
  };
}

type EfPreview = Awaited<
  ReturnType<typeof previewEfashionMatchByReference>
> extends infer T
  ? T extends { success: true; data: infer D }
    ? D
    : never
  : never;

function normalizeEfashion(p: EfPreview): LinkPreview {
  // Sur eFashion la clé de candidate = `${efashionProductId}:${efashionColorId}` pour rester unique.
  // Le serveur renvoie existingLinks avec juste l'efashionProductId (Color.id → number).
  // On doit reconstruire la clé composite en retrouvant le candidat matching, sinon
  // le mapping stocke un id qui ne matche aucun candidate.id → pré-sélection cassée
  // + suggestion auto bloquée à la réouverture.
  const candidateByEfProductId = new Map<number, string>();
  for (const c of p.candidates) {
    if (!candidateByEfProductId.has(c.efashionProductId)) {
      candidateByEfProductId.set(
        c.efashionProductId,
        `${c.efashionProductId}:${c.efashionColorId}`,
      );
    }
  }
  const existingLinks: Record<string, string> = {};
  for (const [localColorId, efashionProductId] of Object.entries(p.existingLinks)) {
    const compositeId = candidateByEfProductId.get(efashionProductId);
    if (compositeId) existingLinks[localColorId] = compositeId;
  }
  return {
    marketplace: "efashion",
    productId: p.productId,
    productName: p.productName,
    reference: p.reference,
    searchQuery: p.referenceBase,
    marketplaceProductId: p.candidates[0]?.efashionProductId
      ? String(p.candidates[0].efashionProductId)
      : null,
    marketplaceProductName: null,
    marketplaceProductImage: p.candidates[0]?.imageUrl ?? null,
    localColors: p.localColors.map((c) => ({
      productColorId: c.id,
      colorId: c.id,
      name: c.name,
      hex: c.hex,
      patternImage: c.patternImage,
      productImage: c.productImage,
      saleType: "UNIT",
      sizes: [],
      unitPrice: c.unitPrice ?? 0,
      packQuantity: null,
      stock: c.unitStock ?? 0,
      weightKg: c.weightKg ?? null,
    })),
    candidates: p.candidates.map((c) => ({
      id: `${c.efashionProductId}:${c.efashionColorId}`,
      type: "UNIT",
      colorName: c.efashionColorName,
      colorHex: null,
      colorImage: null,
      sizeLabel: "TU",
      packSizes: [],
      packQuantity: null,
      priceUnit: c.priceEur,
      priceTotal: c.priceEur,
      stockQty: c.stockValue ?? 0,
      weightKg: c.weightKg > 0 ? c.weightKg : null,
      isActive: c.visible && !c.supprimer,
      imageUrl: c.imageUrl,
      suggestedLocalColorId: c.suggestedLocalColorId,
      extra: {
        efashionProductId: c.efashionProductId,
        efashionColorId: c.efashionColorId,
      },
    })),
    existingLinks,
    alreadyLinked: p.alreadyLinked,
    missingAttributes: p.missingAttributes,
    extras: {
      referenceBase: p.referenceBase,
      packOnlyColors: p.packOnlyColors,
    },
  };
}

type FaPreview = Awaited<
  ReturnType<typeof previewFaireMatchBySku>
> extends infer T
  ? T extends { success: true; data: infer D }
    ? D
    : never
  : never;

function normalizeFaire(p: FaPreview): LinkPreview {
  return {
    marketplace: "faire",
    productId: p.productId,
    productName: p.productName,
    reference: p.reference,
    searchQuery: p.faireSkuInput,
    marketplaceProductId: p.faireProductId,
    marketplaceProductName: p.faireProductName,
    marketplaceProductImage: p.faireProductImage,
    localColors: p.localColors.map((c) => ({
      productColorId: c.productColorId,
      colorId: c.colorId,
      name: c.name,
      hex: c.hex,
      patternImage: c.patternImage,
      productImage: c.productImage,
      saleType: c.saleType,
      sizes: [],
      unitPrice: c.unitPrice,
      packQuantity: null,
      stock: c.stock,
      weightKg: c.weightKg ?? null,
    })),
    candidates: p.candidates.map((c) => {
      // Faire retourne wholesalePriceCents ET/OU retailPriceCents selon le produit.
      // On préfère wholesale (prix marchand), fallback retail, sinon 0.
      const priceCents = c.wholesalePriceCents ?? c.retailPriceCents ?? 0;
      const priceEur = priceCents ? priceCents / 100 : 0;
      return {
      id: c.faireVariantId,
      type: "UNIT" as const,
      colorName: c.colorLabel ?? c.faireVariantName,
      colorHex: null,
      colorImage: null,
      // Faire n'expose pas de taille structurée — la variante est identifiée
      // uniquement par SKU. On affiche "TU" par défaut.
      sizeLabel: "TU",
      packSizes: [],
      packQuantity: null,
      priceUnit: priceEur,
      priceTotal: priceEur,
      stockQty: c.availableQuantity,
      weightKg: c.weightGrams > 0 ? c.weightGrams / 1000 : null,
      isActive: c.lifecycleState === "PUBLISHED",
      imageUrl: c.imageUrl,
      suggestedLocalColorId: c.suggestedLocalColorId,
      };
    }),
    existingLinks: p.existingLinks,
    alreadyLinked: p.alreadyLinked,
    missingAttributes: [],
    extras: { lifecycleState: p.faireLifecycleState },
  };
}
