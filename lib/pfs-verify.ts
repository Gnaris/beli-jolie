/**
 * PFS Verify — Compare l'état d'un produit sur PFS avec l'état local.
 *
 * Contrairement à `pfsUpdate`, cette fonction ne modifie **rien** ni côté BJ
 * ni côté PFS. Elle produit une liste structurée d'écarts pour affichage
 * dans le tooltip de la pastille de vérification (variante C).
 *
 * Champs comparés (images explicitement ignorées) :
 *  - Fiche produit : nom, description, dimensions, composition, pays,
 *    saison, genre, catégorie, famille, best-seller.
 *  - Par variante (groupée par couleur) : type Unité/Pack (+ signature du
 *    pack), prix, stock, poids, actif.
 *  - Variante en trop sur PFS (couleur qui n'existe plus chez nous).
 *  - Variante manquante sur PFS (existe chez nous mais absente là-bas).
 *
 * Le site local fait foi : dans les tooltips, PFS = "actuel côté PFS",
 * Attendu = "ce que notre site dit".
 */

import { prisma } from "@/lib/prisma";
import { pfsCheckReference, pfsGetVariants, type PfsVariantDetail } from "@/lib/pfs-api";
import {
  pfsGetColors,
  pfsGetCategories,
  pfsGetFamilies,
  pfsGetCountries,
  pfsGetCompositions,
} from "@/lib/pfs-api-write";
import {
  applyMarketplaceMarkup,
  loadMarketplaceMarkupConfigs,
  type MarkupConfig,
} from "@/lib/marketplace-pricing";
import {
  getPfsOutOfStockConfig,
  type PfsOutOfStockProductAction,
} from "@/lib/pfs-out-of-stock-config";
import { mapLocalToPfsStatus, type PfsTargetStatus } from "@/lib/pfs-status";
import { countryName } from "@/lib/countries";
import { logger } from "@/lib/logger";

// ─── Types publics ─────────────────────────────────────────────────────────

export type PfsVerifyIssueField =
  | "name"
  | "description"
  | "dimensions"
  | "composition"
  | "country"
  | "season"
  | "gender"
  | "category"
  | "family"
  | "isBestSeller"
  | "productStatus"
  | "saleType"
  | "price"
  | "stock"
  | "weight"
  | "isActive"
  | "extraVariant"
  | "missingVariant";

export interface PfsVerifyIssue {
  /** "product" : champ de la fiche · "color" : rattaché à une couleur (variante ou extra). */
  scope: "product" | "color";
  field: PfsVerifyIssueField;
  fieldLabel: string;
  /** Rempli quand scope=color. */
  colorRef?: string;
  colorName?: string;
  /** Hex de la couleur locale (pour la pastille dans le tooltip). Null si couleur PFS orpheline. */
  colorHex?: string | null;
  /** Type de vente concerné par l'écart de variante. */
  variantType?: "UNIT" | "PACK";
  /** Quantité du pack (utile pour libellé "Pack de 3"). */
  packQuantity?: number | null;
  /** Valeur actuellement chez PFS. */
  pfsValue: string | null;
  /** Valeur attendue (= côté site). */
  expectedValue: string | null;
  /** Message court pour les extras / missing. */
  note?: string;
  /**
   * Raison humaine pour laquelle « Envoyer PFS » n'est pas applicable
   * automatiquement sur cet écart (ex : mapping local manquant). Non défini =
   * envoi autorisé. Le tooltip grise le bouton et affiche la raison.
   */
  pushBlocked?: string;
  /**
   * Raison humaine pour laquelle « Prendre PFS » n'est pas applicable
   * automatiquement sur cet écart (ex : attribut à mapper côté site — Lot C).
   * Non défini = récupération autorisée. Le tooltip grise le bouton.
   */
  pullBlocked?: string;
}

export interface PfsVerifyResult {
  status: "ok" | "diff";
  issueCount: number;
  issues: PfsVerifyIssue[];
  checkedAt: string; // ISO
}

/** Erreurs communes remontées à la server action. */
export type PfsVerifyError =
  | { kind: "not_linked"; message: string }
  | { kind: "not_found_on_pfs"; message: string }
  | { kind: "pfs_unreachable"; message: string }
  | { kind: "local_missing"; message: string };

// ─── Types internes (mêmes formes que dans pfs-update / pfs-refresh) ───────

interface FullVariant {
  id: string;
  pfsVariantId: string | null;
  unitPrice: number | { toString(): string };
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  variantSizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  colorId: string | null;
  color: { id: string; name: string; hex: string | null; pfsColorRef: string | null } | null;
  pfsColorRefOverride: string | null;
  packLines: {
    colorId: string;
    color: { id: string; name: string; hex: string | null; pfsColorRef: string | null };
    position: number;
    pfsColorRefOverride: string | null;
    sizes: { size: { name: string; pfsSizeRef: string | null }; quantity: number }[];
  }[];
}

interface FullProduct {
  id: string;
  reference: string;
  name: string;
  description: string;
  isBestSeller: boolean;
  /**
   * Statut Prisma local. Typé `string` pour rester compatible avec l'enum
   * `ProductStatus` (ONLINE|OFFLINE|ARCHIVED|SYNCING) sans avoir à importer
   * l'enum dans les tests (qui fabriquent l'objet à la main).
   */
  status: string;
  pfsProductId: string | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionDiameter: number | null;
  dimensionCircumference: number | null;
  sizeDetailsTu: string | null;
  category: {
    name: string;
    pfsCategoryId: string | null;
    pfsCategoryName: string | null;
    pfsGender: string | null;
    pfsFamilyId: string | null;
    pfsFamilyName: string | null;
  };
  colors: FullVariant[];
  compositions: {
    percentage: number | { toString(): string };
    composition: { pfsCompositionRef: string | null; name: string };
  }[];
  countryIsoCode: string | null;
  season: { pfsRef: string | null; name: string } | null;
}

// ─── Helpers partagés (alignés sur pfs-refresh / pfs-update) ───────────────

function buildDimensionsSuffix(
  product: Pick<
    FullProduct,
    "dimensionLength" | "dimensionWidth" | "dimensionHeight" | "dimensionDiameter" | "dimensionCircumference"
  >,
): string {
  const parts: string[] = [];
  if (product.dimensionLength != null) parts.push(`Longueur : ${product.dimensionLength}mm`);
  if (product.dimensionWidth != null) parts.push(`Largeur : ${product.dimensionWidth}mm`);
  if (product.dimensionHeight != null) parts.push(`Hauteur : ${product.dimensionHeight}mm`);
  if (product.dimensionDiameter != null) parts.push(`Diamètre : ${product.dimensionDiameter}mm`);
  if (product.dimensionCircumference != null) parts.push(`Circonférence : ${product.dimensionCircumference}mm`);
  if (parts.length === 0) return "";
  return `\n\nDimensions : ${parts.join(" / ")}`;
}

function resolvePfsColorRef(
  color: { name: string; pfsColorRef: string | null },
  colorRefMap: Map<string, string>,
  overrideRef?: string | null,
): string {
  if (overrideRef?.trim()) return overrideRef.trim();
  if (color.pfsColorRef) return color.pfsColorRef;
  return colorRefMap.get(color.name) ?? color.name;
}

function getEffectiveColorRef(
  variant: FullVariant,
  colorRefMap: Map<string, string>,
): string | null {
  if (!variant.color) return null;
  return resolvePfsColorRef(variant.color, colorRefMap, variant.pfsColorRefOverride);
}

function getPfsUnitPrice(variant: FullVariant, markup?: MarkupConfig): number {
  const price = Number(variant.unitPrice);
  let unitPrice: number;
  if (variant.saleType !== "PACK") {
    unitPrice = price;
  } else {
    const qty = variant.packQuantity && variant.packQuantity > 0 ? variant.packQuantity : 1;
    unitPrice = Math.round((price / qty) * 100) / 100;
  }
  return markup ? applyMarketplaceMarkup(unitPrice, markup) : unitPrice;
}

const getSizeRef = (vs: { size: { name: string; pfsSizeRef: string | null } }) =>
  vs.size.pfsSizeRef || vs.size.name || "TU";

/** Signature stable "colorRef:size:qty|colorRef:size:qty..." indépendante de l'ordre. */
function packSignatureFromLocalVariant(
  variant: FullVariant,
  colorRefMap: Map<string, string>,
): string | null {
  if (variant.saleType !== "PACK") return null;
  const entries: string[] = [];
  if (variant.packLines.length > 0) {
    for (const pl of variant.packLines) {
      if (!pl.color) continue;
      const cRef = resolvePfsColorRef(pl.color, colorRefMap, pl.pfsColorRefOverride);
      if (pl.sizes.length > 0) {
        for (const ps of pl.sizes) {
          entries.push(`${cRef}:${getSizeRef(ps)}:${ps.quantity}`);
        }
      } else {
        entries.push(`${cRef}:TU:${variant.packQuantity ?? 1}`);
      }
    }
  } else if (variant.color) {
    const cRef = resolvePfsColorRef(variant.color, colorRefMap, variant.pfsColorRefOverride);
    const sizes =
      variant.variantSizes.length > 0
        ? variant.variantSizes
        : [{ size: { name: "TU", pfsSizeRef: "TU" }, quantity: variant.packQuantity ?? 1 }];
    for (const vs of sizes) entries.push(`${cRef}:${getSizeRef(vs)}:${vs.quantity}`);
  }
  return entries.sort().join("|");
}

function packSignatureFromPfsVariant(pv: PfsVariantDetail): string | null {
  if (pv.type !== "PACK" || !pv.packs) return null;
  const entries: string[] = [];
  for (const p of pv.packs) {
    for (const s of p.sizes) {
      entries.push(`${p.color.reference}:${s.size}:${s.qty}`);
    }
  }
  return entries.sort().join("|");
}

// ─── Load local product ─────────────────────────────────────────────────────

async function loadProductFull(productId: string): Promise<FullProduct | null> {
  return prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      isBestSeller: true,
      status: true,
      pfsProductId: true,
      dimensionLength: true,
      dimensionWidth: true,
      dimensionHeight: true,
      dimensionDiameter: true,
      dimensionCircumference: true,
      sizeDetailsTu: true,
      category: {
        select: {
          name: true,
          pfsCategoryId: true,
          pfsCategoryName: true,
          pfsGender: true,
          pfsFamilyId: true,
          pfsFamilyName: true,
        },
      },
      colors: {
        select: {
          id: true,
          pfsVariantId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
          },
          colorId: true,
          color: { select: { id: true, name: true, hex: true, pfsColorRef: true } },
          pfsColorRefOverride: true,
          packLines: {
            select: {
              colorId: true,
              color: { select: { id: true, name: true, hex: true, pfsColorRef: true } },
              position: true,
              pfsColorRefOverride: true,
              sizes: {
                select: { size: { select: { name: true, pfsSizeRef: true } }, quantity: true },
                orderBy: { size: { position: "asc" as const } },
              },
            },
            orderBy: { position: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
      compositions: {
        select: { percentage: true, composition: { select: { pfsCompositionRef: true, name: true } } },
      },
      countryIsoCode: true,
      season: { select: { pfsRef: true, name: true } },
    },
  }) as unknown as FullProduct | null;
}

// ─── Snapshots (locale expected vs live PFS) ───────────────────────────────

interface ProductLevelSnapshot {
  name: string;
  description: string; // description + dimensions suffix, avec dimensions dedans
  composition: string; // "REF:val|REF:val" trié
  country: string;
  gender: string | null;
  category: string | null;
  family: string | null;
  isBestSeller: boolean;
}

function buildExpectedProductSnapshot(p: FullProduct): ProductLevelSnapshot {
  const compo = p.compositions
    .filter((c) => c.composition.pfsCompositionRef)
    .map((c) => ({ id: normalizeCompositionRef(c.composition.pfsCompositionRef!), value: Number(c.percentage) }));
  if (compo.length === 0) compo.push({ id: "ACIERINOXYDABLE", value: 100 });
  const compoStr = compo
    .map((c) => `${c.id}:${c.value}`)
    .sort()
    .join("|");
  return {
    name: p.name,
    description: p.description + buildDimensionsSuffix(p),
    composition: compoStr,
    country: p.countryIsoCode ?? "CN",
    gender: p.category.pfsGender ?? null,
    category: p.category.pfsCategoryId ?? null,
    family: p.category.pfsFamilyId ?? null,
    isBestSeller: p.isBestSeller,
  };
}

interface PfsProductLive {
  name: string;
  description: string;
  composition: string;
  country: string;
  gender: string | null;
  category: string | null;
  family: string | null;
  isBestSeller: boolean;
}

function extractPfsProductLive(
  checkRef: NonNullable<Awaited<ReturnType<typeof pfsCheckReference>>["product"]>,
  variants: PfsVariantDetail[],
): PfsProductLive {
  const compoStr = (checkRef.material_composition ?? [])
    .map((c) => `${normalizeCompositionRef(c.reference)}:${Number(c.percentage)}`)
    .sort()
    .join("|");
  // is_star : PFS le porte au niveau produit, mais checkReference ne l'expose
  // pas. On prend la valeur de la 1ʳᵉ variante retournée par getVariants
  // (fiable en pratique : PFS applique STAR/REMOVE_STAR au produit entier).
  const anyStar = variants.some((v) => v.is_star === true);
  return {
    name: checkRef.label?.fr ?? "",
    description: checkRef.description?.fr ?? "",
    composition: compoStr,
    country: checkRef.country_of_manufacture ?? "",
    gender: checkRef.gender?.reference ?? null,
    category: checkRef.category?.id ?? null,
    family: checkRef.family?.id ?? null,
    isBestSeller: anyStar,
  };
}

// ─── Comparaison variante par variante ─────────────────────────────────────

interface LocalVariantForCompare {
  local: FullVariant;
  colorRef: string;      // référence PFS résolue
  colorName: string;     // nom local (pour libellé fallback)
  colorHex: string | null;
  expected: {
    type: "UNIT" | "PACK";
    price: number;
    stock: number;
    weight: number;
    isActive: boolean;
    packSignature: string | null;
    packQuantity: number | null;
  };
}

function buildLocalVariantsForCompare(
  product: FullProduct,
  colorRefMap: Map<string, string>,
  pfsMarkup: MarkupConfig | undefined,
  deactivateOnZeroStock: boolean,
): LocalVariantForCompare[] {
  const out: LocalVariantForCompare[] = [];
  for (const v of product.colors) {
    const colorRef = getEffectiveColorRef(v, colorRefMap);
    // Une variante sans mapping couleur PFS ne peut pas être comparée (elle
    // ne devrait même pas être publiée). On la saute silencieusement.
    if (!colorRef || !v.color) continue;
    out.push({
      local: v,
      colorRef,
      colorName: v.color.name,
      colorHex: v.color.hex,
      expected: {
        type: v.saleType,
        price: getPfsUnitPrice(v, pfsMarkup),
        stock: v.stock ?? 0,
        weight: v.weight,
        isActive: deactivateOnZeroStock ? (v.stock ?? 0) > 0 : true,
        packSignature: packSignatureFromLocalVariant(v, colorRefMap),
        packQuantity: v.packQuantity,
      },
    });
  }
  return out;
}

/**
 * Normalise une référence couleur pour le matching variante ↔ variante.
 * Sans normalisation, "Rose" (local) vs "ROSE" (PFS) ratait le match et
 * produisait à tort un couple extra+missing au lieu de comparer prix/stock/
 * poids/actif. Casse, espaces et accents sont neutralisés.
 */
function normalizeColorRef(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function pfsVariantMatchKey(pv: PfsVariantDetail): string {
  if (pv.type === "ITEM" && pv.item) {
    return `UNIT|${normalizeColorRef(pv.item.color.reference)}`;
  }
  if (pv.type === "PACK" && pv.packs && pv.packs.length > 0) {
    // Un PACK est identifié par sa couleur principale (première pack entry
    // côté PFS = la couleur « owner » du pack) + type.
    return `PACK|${normalizeColorRef(pv.packs[0].color.reference)}`;
  }
  return `?|${pv.id}`;
}

function localMatchKey(l: LocalVariantForCompare): string {
  return `${l.expected.type}|${normalizeColorRef(l.colorRef)}`;
}

function labelForVariantType(t: "UNIT" | "PACK", packQty: number | null | undefined): string {
  if (t === "UNIT") return "Unité";
  if (packQty && packQty > 1) return `Pack de ${packQty}`;
  return "Pack";
}

// ─── Comparateur principal ─────────────────────────────────────────────────

/**
 * Table de labels pour transformer les identifiants techniques PFS (Salesforce
 * IDs, refs codes) en libellés humains français dans les tooltips. Optionnel :
 * si absent, on affiche les identifiants bruts (rétro-compat tests).
 */
export interface PfsLabelMaps {
  categoryLabelById?: Map<string, string>;
  familyLabelById?: Map<string, string>;
  compositionLabelByRef?: Map<string, string>;
  countryLabelByIso?: Map<string, string>;
}

const GENDER_FR: Record<string, string> = {
  WOMAN: "Femme",
  MAN: "Homme",
  KID: "Enfant",
  SUPPLIES: "Fournitures",
};

const PULL_LOT_C_REASON =
  "Récupération non disponible : cet attribut a besoin d'être rattaché côté site (arrivera dans un prochain lot).";

export function comparePfsProduct(
  local: FullProduct,
  pfsProduct: NonNullable<Awaited<ReturnType<typeof pfsCheckReference>>["product"]>,
  pfsVariants: PfsVariantDetail[],
  colorRefMap: Map<string, string>,
  opts: {
    pfsMarkup?: MarkupConfig;
    deactivateOnZeroStock: boolean;
    /** Action PFS à appliquer sur produit quand toutes les variantes sont en
     *  rupture. Sert à calculer le statut PFS attendu depuis le statut local. */
    outOfStockProductAction?: PfsOutOfStockProductAction;
    /** Tables de correspondance pour afficher des noms humains à la place
     *  des IDs Salesforce / refs techniques. */
    labels?: PfsLabelMaps;
  },
): PfsVerifyIssue[] {
  const issues: PfsVerifyIssue[] = [];

  // 1) Champs fiche produit
  const expectedP = buildExpectedProductSnapshot(local);
  const actualP = extractPfsProductLive(pfsProduct, pfsVariants);

  const pushProduct = (
    field: PfsVerifyIssueField,
    label: string,
    pfsValue: string | null,
    expectedValue: string | null,
  ) => {
    issues.push({
      scope: "product",
      field,
      fieldLabel: label,
      pfsValue,
      expectedValue,
    });
  };

  if (expectedP.name !== actualP.name)
    pushProduct("name", "Nom", actualP.name, expectedP.name);

  // Description ET dimensions vivent dans le même champ PFS (description
  // suffixée par "\n\nDimensions : ..."). On sépare en 2 lignes de tooltip
  // pour ne pas polluer si seul l'un des deux diffère.
  const expectedDesc = local.description;
  const actualFull = actualP.description;
  const dimIdx = actualFull.indexOf("\n\nDimensions :");
  const actualDescOnly = dimIdx >= 0 ? actualFull.slice(0, dimIdx) : actualFull;
  const actualDimSuffix = dimIdx >= 0 ? actualFull.slice(dimIdx) : "";
  const expectedDimSuffix = buildDimensionsSuffix(local);

  if (expectedDesc !== actualDescOnly)
    pushProduct("description", "Description", actualDescOnly, expectedDesc);
  if (expectedDimSuffix.trim() !== actualDimSuffix.trim())
    pushProduct(
      "dimensions",
      "Dimensions",
      actualDimSuffix.replace(/^\n\nDimensions : /, "") || "(aucune)",
      expectedDimSuffix.replace(/^\n\nDimensions : /, "") || "(aucune)",
    );

  const labels = opts.labels;

  if (expectedP.composition !== actualP.composition) {
    const iss: PfsVerifyIssue = {
      scope: "product",
      field: "composition",
      fieldLabel: "Composition",
      pfsValue: formatCompositionForDisplayHuman(actualP.composition, labels?.compositionLabelByRef),
      expectedValue: formatCompositionForDisplayHuman(expectedP.composition, labels?.compositionLabelByRef, local.compositions),
      pullBlocked: PULL_LOT_C_REASON,
    };
    issues.push(iss);
  }

  if (expectedP.country !== actualP.country) {
    // Priorité au libellé PFS ; fallback sur la biblio locale
    // (`lib/countries.ts::countryName`) qui couvre TOUS les codes ISO —
    // évite d'afficher "CN" ou "FR" bruts si l'API PFS n'a pas renvoyé
    // le libellé français ou si l'appel a échoué.
    const humanCountry = (iso: string): string => {
      if (!iso) return "(vide)";
      const fromPfs = labels?.countryLabelByIso?.get(iso);
      if (fromPfs) return fromPfs;
      const fromLocal = countryName(iso);
      // countryName retombe sur l'ISO majuscule si inconnu — on garde ce
      // fallback pour être défensif.
      return fromLocal || iso;
    };
    issues.push({
      scope: "product",
      field: "country",
      fieldLabel: "Pays de fabrication",
      pfsValue: humanCountry(actualP.country),
      expectedValue: humanCountry(expectedP.country),
      pullBlocked: PULL_LOT_C_REASON,
    });
  }

  if (expectedP.gender && actualP.gender && expectedP.gender !== actualP.gender) {
    issues.push({
      scope: "product",
      field: "gender",
      fieldLabel: "Genre",
      pfsValue: GENDER_FR[actualP.gender] ?? actualP.gender,
      expectedValue: GENDER_FR[expectedP.gender] ?? expectedP.gender,
      pullBlocked: PULL_LOT_C_REASON,
    });
  }

  // Catégorie et famille : on merge en un seul écart « Catégorie » car
  // dans notre modèle, la famille est déduite de la catégorie (elles
  // changent ensemble). On affiche des libellés humains : côté site on
  // prend `pfsCategoryName` (mapping saisi par la cliente) sinon `name` ;
  // côté PFS on cherche le libellé via le lookup id → nom.
  const categoryDiffers =
    expectedP.category && actualP.category && expectedP.category !== actualP.category;
  const familyDiffers =
    expectedP.family && actualP.family && expectedP.family !== actualP.family;
  if (categoryDiffers || familyDiffers) {
    const pfsCatLabel = labels?.categoryLabelById?.get(pfsProduct.category?.id ?? "") ?? "(inconnue)";
    const localCatLabel = local.category.pfsCategoryName || local.category.name;
    issues.push({
      scope: "product",
      field: "category",
      fieldLabel: "Catégorie",
      pfsValue: pfsCatLabel,
      expectedValue: localCatLabel,
      pullBlocked: PULL_LOT_C_REASON,
    });
  }

  if (expectedP.isBestSeller !== actualP.isBestSeller)
    pushProduct(
      "isBestSeller",
      "Best-seller",
      actualP.isBestSeller ? "Oui" : "Non",
      expectedP.isBestSeller ? "Oui" : "Non",
    );

  // Statut produit : compare le statut PFS effectif (READY_FOR_SALE / DRAFT /
  // ARCHIVED / DELETED) au statut attendu, calculé depuis le statut local
  // (ONLINE/OFFLINE/ARCHIVED) + règle "toutes variantes en rupture".
  // On IGNORE le statut si le local est SYNCING (état transitoire) ou si le
  // PFS renvoie un statut inconnu — pas d'écart affiché dans ces cas.
  if (local.status !== "SYNCING") {
    const allZero = local.colors.every((c) => (c.stock ?? 0) <= 0);
    const expectedPfsStatus = mapLocalToPfsStatus(
      local.status,
      allZero,
      opts.outOfStockProductAction ?? "archived",
    );
    const actualPfsStatus = String(pfsProduct.status ?? "").toUpperCase();
    if (
      isKnownPfsStatus(actualPfsStatus) &&
      actualPfsStatus !== expectedPfsStatus
    ) {
      pushProduct(
        "productStatus",
        "Statut produit",
        labelForPfsStatus(actualPfsStatus),
        labelForPfsStatus(expectedPfsStatus),
      );
    }
  }

  // 2) Variantes — matching par (type, colorRef)
  const locals = buildLocalVariantsForCompare(
    local,
    colorRefMap,
    opts.pfsMarkup,
    opts.deactivateOnZeroStock,
  );
  const localByKey = new Map<string, LocalVariantForCompare>();
  for (const l of locals) localByKey.set(localMatchKey(l), l);

  const pfsByKey = new Map<string, PfsVariantDetail>();
  for (const pv of pfsVariants) pfsByKey.set(pfsVariantMatchKey(pv), pv);

  const seenPfsIds = new Set<string>();

  for (const l of locals) {
    const key = localMatchKey(l);
    const pv = pfsByKey.get(key);
    if (!pv) {
      // Variante attendue mais absente sur PFS
      issues.push({
        scope: "color",
        field: "missingVariant",
        fieldLabel: `Variante ${labelForVariantType(l.expected.type, l.expected.packQuantity).toLowerCase()} manquante sur PFS`,
        colorRef: l.colorRef,
        colorName: l.colorName,
        colorHex: l.colorHex,
        variantType: l.expected.type,
        packQuantity: l.expected.packQuantity,
        pfsValue: null,
        expectedValue: null,
        note: "Cette variante existe sur notre site mais pas sur PFS.",
      });
      continue;
    }
    seenPfsIds.add(pv.id);
    // Comparaisons variantes
    const pushV = (
      field: PfsVerifyIssueField,
      label: string,
      pfsValue: string | null,
      expectedValue: string | null,
    ) => {
      issues.push({
        scope: "color",
        field,
        fieldLabel: label,
        colorRef: l.colorRef,
        colorName: l.colorName,
        colorHex: l.colorHex,
        variantType: l.expected.type,
        packQuantity: l.expected.packQuantity,
        pfsValue,
        expectedValue,
      });
    };
    const pfsPrice = Number(pv.price_sale?.unit?.value ?? 0);
    const priceMatch = Math.abs(pfsPrice - Number(l.expected.price)) < 0.005;
    if (!priceMatch)
      pushV("price", "Prix", `${pfsPrice.toFixed(2)} €`, `${l.expected.price.toFixed(2)} €`);
    const pfsStock = Number(pv.stock_qty ?? 0);
    if (pfsStock !== Number(l.expected.stock))
      pushV("stock", "Stock", String(pfsStock), String(l.expected.stock));
    // Poids : force Number() sur les deux côtés (défensif contre du string
    // renvoyé par PFS ou un Decimal Prisma inattendu). Attention : PFS et
    // notre BDD stockent le poids en KILOGRAMMES (0.002 = 2g), pas en g.
    // Tolérance = 0.0005 kg (0.5g) — plus fin que le gramme, qui est la
    // granularité pratique côté bijou. Une tolérance trop large (0.01 kg
    // = 10g) écrasait totalement les modifications côté PFS.
    const pfsWeight = Number(pv.weight ?? 0);
    const expectedWeight = Number(l.expected.weight ?? 0);
    if (Math.abs(pfsWeight - expectedWeight) > 0.0005) {
      pushV(
        "weight",
        "Poids",
        formatWeight(pfsWeight),
        formatWeight(expectedWeight),
      );
    }
    if (pv.is_active !== l.expected.isActive)
      pushV(
        "isActive",
        "Variante active",
        pv.is_active ? "Oui" : "Non",
        l.expected.isActive ? "Oui" : "Non",
      );
    // Signature du pack : détecte les changements de composition du pack
    // (couleurs / tailles / quantités). Seulement si les 2 sont PACK.
    if (l.expected.type === "PACK") {
      const pfsSig = packSignatureFromPfsVariant(pv);
      if (pfsSig !== l.expected.packSignature) {
        pushV(
          "saleType",
          "Composition du pack",
          pfsSig ?? "(aucune)",
          l.expected.packSignature ?? "(aucune)",
        );
      }
    }
  }

  // 3) Variantes PFS orphelines → à retirer
  for (const pv of pfsVariants) {
    if (seenPfsIds.has(pv.id)) continue;
    const colorRef =
      pv.item?.color.reference ??
      pv.packs?.[0]?.color.reference ??
      "?";
    const colorName =
      pv.item?.color.labels?.fr ??
      pv.packs?.[0]?.color.labels?.fr ??
      colorRef;
    const colorHex =
      pv.item?.color.value ??
      pv.packs?.[0]?.color.value ??
      null;
    const type = pv.type === "ITEM" ? "UNIT" : "PACK";
    issues.push({
      scope: "color",
      field: "extraVariant",
      fieldLabel: `Variante ${labelForVariantType(type, null).toLowerCase()} en trop sur PFS`,
      colorRef,
      colorName,
      colorHex,
      variantType: type,
      pfsValue: null,
      expectedValue: null,
      note: "Cette variante existe sur PFS mais plus sur notre site.",
    });
  }

  return issues;
}

/**
 * Normalise une référence de composition pour la comparaison :
 * uppercase + retrait des espaces et accents. Évite les faux positifs
 * quand une composition locale est stockée en libellé humain ("Acier
 * inoxydable") plutôt qu'en code PFS strict ("ACIERINOXYDABLE").
 */
function normalizeCompositionRef(ref: string): string {
  return ref
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * Formate un poids en kg pour l'affichage. Bijou = grammes → arrondi au 0.1g.
 * Au-delà de 1 kg (rare) → affichage en kg à 2 décimales.
 */
function formatWeight(kg: number): string {
  if (kg >= 1) return `${kg.toFixed(2)} kg`;
  const grams = kg * 1000;
  return `${Math.round(grams * 10) / 10} g`;
}

/**
 * Reconnaît un statut PFS connu (les autres — string vide, valeur inattendue —
 * sont ignorés pour éviter des faux positifs).
 */
function isKnownPfsStatus(s: string): s is PfsTargetStatus | "NEW" {
  return (
    s === "READY_FOR_SALE" ||
    s === "DRAFT" ||
    s === "ARCHIVED" ||
    s === "DELETED" ||
    s === "NEW"
  );
}

/** Libellé humain FR pour un statut PFS. */
function labelForPfsStatus(s: string): string {
  switch (s) {
    case "READY_FOR_SALE": return "En ligne";
    case "DRAFT": return "Hors ligne (brouillon)";
    case "ARCHIVED": return "Archivé";
    case "DELETED": return "Supprimé";
    case "NEW": return "Nouveau";
    default: return s || "(inconnu)";
  }
}

/** Rend "REF:val|REF:val" en "REF 80%, REF 20%" pour l'affichage. */
function formatCompositionForDisplay(sig: string): string {
  if (!sig) return "(vide)";
  return sig
    .split("|")
    .map((s) => {
      const [ref, val] = s.split(":");
      return `${ref} ${val}%`;
    })
    .join(", ");
}

/**
 * Version humanisée de la composition : traduit chaque REF en libellé
 * français via `compositionLabelByRef` (map PFS `pfsGetCompositions`).
 * `localCompositions` sert de fallback pour la version « attendue » afin
 * d'afficher le nom local plutôt qu'un REF normalisé si le mapping PFS
 * ne connaît pas la référence.
 */
function formatCompositionForDisplayHuman(
  sig: string,
  labelMap?: Map<string, string>,
  localCompositions?: FullProduct["compositions"],
): string {
  if (!sig) return "(vide)";
  return sig
    .split("|")
    .map((s) => {
      const [ref, val] = s.split(":");
      let label = labelMap?.get(ref) ?? "";
      if (!label && localCompositions) {
        const found = localCompositions.find(
          (c) =>
            normalizeCompositionRef(c.composition.pfsCompositionRef ?? "") === ref,
        );
        if (found) label = found.composition.name;
      }
      return `${label || ref} ${val}%`;
    })
    .join(", ");
}

// ─── Entrée publique : verify un produit ───────────────────────────────────

export async function verifyPfsProduct(
  productId: string,
): Promise<{ ok: true; result: PfsVerifyResult } | { ok: false; error: PfsVerifyError }> {
  const product = await loadProductFull(productId);
  if (!product) {
    return { ok: false, error: { kind: "local_missing", message: "Produit introuvable en base" } };
  }
  if (!product.pfsProductId) {
    return {
      ok: false,
      error: { kind: "not_linked", message: "Produit non publié sur PFS" },
    };
  }

  // 1) PFS product live via checkReference
  let checkRef: Awaited<ReturnType<typeof pfsCheckReference>>;
  try {
    checkRef = await pfsCheckReference(product.reference);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[PFS Verify] checkReference failed", { reference: product.reference, error: msg });
    return { ok: false, error: { kind: "pfs_unreachable", message: msg } };
  }
  if (!checkRef?.exists || !checkRef.product) {
    return {
      ok: false,
      error: { kind: "not_found_on_pfs", message: `Référence ${product.reference} inexistante sur PFS` },
    };
  }

  // 2) PFS variants (correct prices/stock/weight/is_star)
  let variantsResp: Awaited<ReturnType<typeof pfsGetVariants>>;
  try {
    variantsResp = await pfsGetVariants(checkRef.product.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[PFS Verify] getVariants failed", {
      pfsProductId: checkRef.product.id,
      error: msg,
    });
    return { ok: false, error: { kind: "pfs_unreachable", message: msg } };
  }

  // 3) Mapping couleurs + markup + labels PFS pour l'affichage humain
  const [colorRefMap, markupConfigs, outOfStockCfg, labelMaps] = await Promise.all([
    buildColorLabelToRefMap(),
    loadMarketplaceMarkupConfigs(),
    getPfsOutOfStockConfig(),
    buildPfsLabelMaps(),
  ]);

  const issues = comparePfsProduct(
    product,
    checkRef.product,
    variantsResp.data ?? [],
    colorRefMap,
    {
      pfsMarkup: markupConfigs.pfs,
      deactivateOnZeroStock: outOfStockCfg.deactivateVariant,
      outOfStockProductAction: outOfStockCfg.productAction,
      labels: labelMaps,
    },
  );

  return {
    ok: true,
    result: {
      status: issues.length === 0 ? "ok" : "diff",
      issueCount: issues.length,
      issues,
      checkedAt: new Date().toISOString(),
    },
  };
}

/**
 * Charge en parallèle les 4 listes d'attributs PFS et bâtit des Map ID → label
 * français pour catégorie, famille, composition (par ref) et pays (par ISO).
 * En cas d'échec, on renvoie des maps vides plutôt que de bloquer la vérif :
 * la comparaison retombera sur les identifiants bruts.
 */
async function buildPfsLabelMaps(): Promise<PfsLabelMaps> {
  const maps: PfsLabelMaps = {
    categoryLabelById: new Map(),
    familyLabelById: new Map(),
    compositionLabelByRef: new Map(),
    countryLabelByIso: new Map(),
  };
  await Promise.all([
    pfsGetCategories()
      .then((cats) => {
        for (const c of cats) {
          const lbl = c.labels?.fr?.trim();
          if (lbl) maps.categoryLabelById!.set(c.id, lbl);
        }
      })
      .catch((err) => logger.warn("[PFS Verify] pfsGetCategories failed", { error: err })),
    pfsGetFamilies()
      .then((fams) => {
        for (const f of fams) {
          const lbl = f.labels?.fr?.trim();
          if (lbl) maps.familyLabelById!.set(f.id, lbl);
        }
      })
      .catch((err) => logger.warn("[PFS Verify] pfsGetFamilies failed", { error: err })),
    pfsGetCompositions()
      .then((cs) => {
        for (const c of cs) {
          const lbl = c.labels?.fr?.trim();
          if (lbl) {
            maps.compositionLabelByRef!.set(normalizeCompositionRef(c.reference), lbl);
          }
        }
      })
      .catch((err) => logger.warn("[PFS Verify] pfsGetCompositions failed", { error: err })),
    pfsGetCountries()
      .then((countries) => {
        for (const c of countries) {
          const lbl = c.labels?.fr?.trim();
          if (lbl) maps.countryLabelByIso!.set(c.reference, lbl);
        }
      })
      .catch((err) => logger.warn("[PFS Verify] pfsGetCountries failed", { error: err })),
  ]);
  return maps;
}

async function buildColorLabelToRefMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const pfsColors = await pfsGetColors();
    for (const c of pfsColors) {
      const frLabel = c.labels?.fr?.trim();
      if (frLabel) map.set(frLabel, c.reference);
      map.set(c.reference, c.reference);
    }
  } catch (err) {
    logger.warn("[PFS Verify] Failed to load PFS color refs", { error: err });
  }
  return map;
}
