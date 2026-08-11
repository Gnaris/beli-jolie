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
import { mapLocalToPfsStatus, type PfsTargetStatus } from "@/lib/pfs-status";
import { countryName } from "@/lib/countries";
import { logger } from "@/lib/logger";
import { pfsAdminFetchMaterialComposition } from "@/lib/pfs-admin-api";

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
  | "missingVariant"
  | "duplicatePfsVariant";

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
  /**
   * Identifiant PFS de la variante — indispensable pour `extraVariant` (permet
   * de la supprimer côté PFS ou de l'importer chez nous depuis la modale
   * d'écarts sans re-fetch complet). Non renseigné pour les issues
   * `missingVariant` (la variante n'existe pas encore côté PFS).
   */
  pfsVariantId?: string;
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
  /**
   * Marque un blocage FICHE COMPLÈTE : le mapping BJ vers PFS n'existe pas
   * (ex : la catégorie BJ « Bagues » n'a pas de pfsCategoryId renseigné). Tant
   * que ce flag est posé sur au moins un écart du produit, le drawer d'audit
   * désactive le bouton « Modifier » de la carte et l'entoure en rouge — la
   * cliente doit corriger le mapping côté site puis relancer l'audit.
   */
  blockingMappingIssue?: string;
  /**
   * Compositions PFS présentes sur ce produit mais absentes de la bibliothèque
   * BJ locale (dédoublonnées par Uid). Utilisé par l'UI de l'audit pour
   * proposer un raccourci « Créer cette composition » à même la carte produit
   * + agrégation en top bar de tout le tiroir. Chaque item est prêt à être
   * passé à `createCompositionsFromPfsAuditAction`.
   */
  missingLocalPfs?: PfsMissingCompositionInfoLite[];
}

/**
 * Version « lite » de `PfsMissingCompositionInfo` (défini côté server-only
 * pfs-verify-apply.ts, qui importe Prisma). Reprise ici pour rester
 * utilisable dans les composants client via `PfsVerifyIssue`.
 */
export interface PfsMissingCompositionInfoLite {
  pfsUid: string;
  pfsRef: string;
  suggestedName: string;
  labels: Record<string, string>;
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
  /** Drapeau « masquée côté client » — pilote la comparaison `is_active` PFS. */
  disabled: boolean;
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
    // `id` optionnel car les tests fabriquent des Composition sans id ; en
    // requête réelle (`loadProductFull`) on le charge pour permettre
    // l'auto-guérison de `pfsCompositionRef`.
    composition: { id?: string; pfsCompositionRef: string | null; pfsCompositionUid?: string | null; name: string };
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
          disabled: true,
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
        select: { percentage: true, composition: { select: { id: true, pfsCompositionRef: true, pfsCompositionUid: true, name: true } } },
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
        // On compare l'état ACTIF/INACTIF sur le seul flag `disabled` — c'est
        // ce même flag que le push renvoie à PFS (`enable: !disabled`). Le
        // stock n'entre plus en compte : une variante en rupture reste active
        // côté PFS tant qu'elle n'est pas explicitement désactivée localement.
        isActive: !v.disabled,
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

/**
 * Snapshot de la biblio Composition locale du tenant courant. Utilisé par
 * `reconcileCompositionsByLabel` pour distinguer « compo absente de la biblio
 * (création requise) » vs « compo présente en biblio mais pas rattachée à ce
 * produit (le pull la rattachera automatiquement) ».
 */
export interface CompositionLibraryIndex {
  /** Salesforce Uids présents dans la biblio locale. */
  uids: Set<string>;
  /** `normalizeCompositionRef(pfsCompositionRef)` des entrées de la biblio. */
  refs: Set<string>;
  /** `normalizeCompositionRef(name)` des entrées de la biblio. */
  names: Set<string>;
}

/** Guérison automatique de `Color.pfsColorRef` détectée pendant le compare :
 *  la couleur locale a matché une variante PFS orpheline via son label FR,
 *  mais son `pfsColorRef` local est vide ou différent. `verifyPfsProduct`
 *  applique ces guérisons après la compare, comme pour les compositions. */
export interface ColorAutoHealAction {
  localColorId: string;
  localColorName: string;
  currentPfsRef: string | null;
  newPfsRef: string;
}

/**
 * Contexte préchargé partagé entre plusieurs `verifyPfsProduct` d'un même lot.
 * Regroupe les 5 tables globales PFS (colors + 4 attributs) et les 2 configs
 * BDD (markup pricing + out-of-stock) — toutes identiques d'un produit à
 * l'autre. Sans ce contexte, chaque verify refait 5 HTTP + 2 BDD redondants.
 */
export interface PfsVerifyContext {
  colorRefMap: Map<string, string>;
  pfsMarkup: MarkupConfig | undefined;
  labels: PfsLabelMaps;
  /** Snapshot biblio Composition (tenant scopé). Optionnel : tests sans DB
   *  passent `undefined` et retombent sur l'ancien comportement. */
  compositionLibrary?: CompositionLibraryIndex;
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
    /** Tables de correspondance pour afficher des noms humains à la place
     *  des IDs Salesforce / refs techniques. */
    labels?: PfsLabelMaps;
    /**
     * Callback invoqué quand la composition PFS et la composition locale
     * matchent par nom (libellé FR) mais que le `pfsCompositionRef` local
     * est différent de la vraie ref PFS. Le caller (`verifyPfsProduct`)
     * l'utilise pour auto-guérir en base. Ne pas passer = pas d'effet.
     */
    onCompositionAutoHeal?: (heal: CompositionAutoHealAction) => void;
    /** Callback équivalent pour les couleurs — invoqué quand une variante
     *  PFS orpheline matche une couleur locale via son libellé FR mais que
     *  `Color.pfsColorRef` est vide ou différent. */
    onColorAutoHeal?: (heal: ColorAutoHealAction) => void;
    /** Biblio Composition du tenant (voir CompositionLibraryIndex). Sans
     *  elle, le reconcile bloque sur toute compo non rattachée au produit,
     *  même si elle est déjà dans Paramètres > Compositions. */
    compositionLibrary?: CompositionLibraryIndex;
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

  // Composition — 4 cas :
  //  (1) Sig identique côté BJ et PFS → aucun écart.
  //  (2) Sig différent MAIS chaque matière PFS trouve une compo locale par
  //      nom FR (le mauvais `pfsCompositionRef` local sera guéri via callback
  //      et l'écart est masqué : plus de faux positif "Coton" vs "COTTON").
  //  (3a) `missingLocalNames` > 0 : PFS renvoie une matière absente du
  //       catalogue BJ (par ref/uid/nom) → bloquant, création requise dans
  //       Paramètres > Compositions (ou raccourci « Créer en 1 clic »).
  //  (3b) `orphanLocalNames` > 0 uniquement (ou écart de % seul) : BJ a plus
  //       de matières que PFS (ou % différents) mais chaque matière PFS a bien
  //       été identifiée localement → aucun mapping requis, le pull « Corriger
  //       depuis PFS » remplacera la compo BJ par celle de PFS et retirera
  //       les extras (PFS = source de vérité côté audit).
  if (expectedP.composition !== actualP.composition) {
    const reconcile = reconcileCompositionsByLabel(
      local.compositions,
      pfsProduct.material_composition ?? [],
      labels?.compositionLabelByRef,
      opts.compositionLibrary,
    );

    if (reconcile.aligned) {
      // Cas (2) — même matière, mauvais code PFS local → auto-guérison.
      for (const h of reconcile.heals) opts.onCompositionAutoHeal?.(h);
    } else if (reconcile.missingLocalNames.length > 0) {
      // Cas (3a) — PFS a une matière absente du catalogue BJ. Bloquant :
      // on ne peut pas résoudre le pull sans que la compo existe côté BJ.
      // On ajoute les orphelines locales à titre d'information seulement.
      const missingList = reconcile.missingLocalNames.join(" · ");
      const blockingParts: string[] = [
        `Composition « ${missingList} » présente sur PFS mais absente de votre catalogue — créez-la dans Paramètres > Compositions avec la bonne référence PFS.`,
      ];
      const parts: string[] = [`Manque côté BJ : ${missingList}`];
      if (reconcile.orphanLocalNames.length > 0) {
        const orphanList = reconcile.orphanLocalNames.join(" · ");
        parts.push(`En trop côté BJ : ${orphanList}`);
      }
      issues.push({
        scope: "product",
        field: "composition",
        fieldLabel: "Composition",
        pfsValue: formatCompositionForDisplayHuman(actualP.composition, labels?.compositionLabelByRef),
        expectedValue: parts.join(" · "),
        pullBlocked: blockingParts.join(" "),
        blockingMappingIssue: `${blockingParts.join(" ")} Puis relancez l'audit.`,
        // Métadonnées pour raccourci UI « Créer cette composition ».
        missingLocalPfs: reconcile.missingLocalPfs.length > 0 ? reconcile.missingLocalPfs : undefined,
      });
    } else {
      // Cas (3b) — écart de % uniquement OU compo BJ orpheline (PFS = source
      // de vérité). Le pull « Corriger depuis PFS » remplacera la compo BJ
      // par celle de PFS et retirera les matières en trop — non bloquant.
      issues.push({
        scope: "product",
        field: "composition",
        fieldLabel: "Composition",
        pfsValue: formatCompositionForDisplayHuman(actualP.composition, labels?.compositionLabelByRef),
        expectedValue: formatCompositionForDisplayHuman(expectedP.composition, labels?.compositionLabelByRef, local.compositions),
      });
    }
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

  // Genre : mapping manquant si PFS retourne un genre mais notre catégorie
  // BJ n'a pas de pfsGender renseigné. La cliente doit compléter côté site.
  if (actualP.gender && !expectedP.gender) {
    issues.push({
      scope: "product",
      field: "gender",
      fieldLabel: "Genre",
      pfsValue: GENDER_FR[actualP.gender] ?? actualP.gender,
      expectedValue: `${local.category.name} — non lié à un genre PFS`,
      pullBlocked: `Genre de la catégorie « ${local.category.name} » non renseigné.`,
      blockingMappingIssue: `La catégorie « ${local.category.name} » n'a pas de genre PFS. Ouvrez Paramètres > Catégories, définissez le genre, puis relancez l'audit.`,
    });
  } else if (expectedP.gender && actualP.gender && expectedP.gender !== actualP.gender) {
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
  // changent ensemble). Deux cas distincts :
  //  - Mapping manquant (BJ n'a pas de pfsCategoryId) → bloque la fiche.
  //  - Écart de valeur classique → à corriger à la main (Lot C).
  const missingCategoryMapping =
    actualP.category && !local.category.pfsCategoryId;
  const categoryDiffers =
    expectedP.category && actualP.category && expectedP.category !== actualP.category;
  const familyDiffers =
    expectedP.family && actualP.family && expectedP.family !== actualP.family;
  if (missingCategoryMapping) {
    const pfsCatLabel = labels?.categoryLabelById?.get(pfsProduct.category?.id ?? "") ?? "(inconnue)";
    issues.push({
      scope: "product",
      field: "category",
      fieldLabel: "Catégorie",
      pfsValue: pfsCatLabel,
      expectedValue: `${local.category.name} — non liée à PFS`,
      pullBlocked: `Catégorie « ${local.category.name} » non liée à PFS.`,
      blockingMappingIssue: `La catégorie « ${local.category.name} » de votre site n'est pas liée à une catégorie PFS. Ouvrez Paramètres > Catégories, renseignez l'ID de catégorie PFS, puis relancez l'audit.`,
    });
  } else if (categoryDiffers || familyDiffers) {
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
    // Le statut local fait foi (règle métier 2026-08-07). Rupture totale ≠
    // auto-archive : c'est à l'admin de choisir. `mapLocalToPfsStatus` mappe
    // seulement ONLINE/OFFLINE/ARCHIVED vers READY_FOR_SALE/DRAFT/ARCHIVED.
    const expectedPfsStatus = mapLocalToPfsStatus(local.status);
    // PFS `NEW` = produit créé mais jamais activé (invisible via listProducts,
    // affiché « brouillon » dans l'UI PFS). Sémantiquement équivalent à
    // ARCHIVED côté BJ (produit invisible en vitrine). On normalise avant
    // comparaison pour ne pas générer d'écart bidon quand local=ARCHIVED ↔
    // PFS=NEW, et pour afficher un libellé cohérent (« Archivé ») dans le modal.
    //
    // PFS `DELETED` = produit supprimé côté PFS (invisible). BJ n'a pas de
    // statut « supprimé » — l'équivalent est ARCHIVED. On normalise DELETED
    // en ARCHIVED avant compare (règle métier posée 2026-08-08) pour ne pas
    // faire clignoter un faux écart quand la cliente choisit « supprimer sur
    // PFS » depuis Paramètres et garde son produit en ARCHIVED chez elle.
    const rawPfsStatus = String(pfsProduct.status ?? "").toUpperCase();
    const actualPfsStatus =
      rawPfsStatus === "NEW" || rawPfsStatus === "DELETED"
        ? "ARCHIVED"
        : rawPfsStatus;
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
  );
  const localByKey = new Map<string, LocalVariantForCompare>();
  for (const l of locals) localByKey.set(localMatchKey(l), l);

  const pfsByKey = new Map<string, PfsVariantDetail>();
  for (const pv of pfsVariants) pfsByKey.set(pfsVariantMatchKey(pv), pv);

  // Fallback label FR : quand un local n'a pas de match par ref, on tente
  // par nom (colorName local ↔ labels.fr de la variante PFS). Corrige les
  // faux positifs « extraVariant + missingVariant » quand PFS renvoie une
  // ref différente pour la même couleur (bug reporté 2026-08-07 sur
  // 13164FLEUR/Issyma : local « Jaune » avec pfsColorRef="YELLOW", PFS
  // renvoyait la variante avec ref différente mais labels.fr="Jaune"). Pose
  // un heal Color.pfsColorRef pour aligner la biblio locale.
  const pfsLabelsMatched = new Set<string>();
  for (const l of locals) {
    const key = localMatchKey(l);
    if (pfsByKey.has(key)) continue;
    const normLocalName = normalizeColorRef(l.colorName);
    // Recherche parmi les PFS du même type dont la ref n'est pas déjà mappée
    // à un autre local et dont le label FR matche le nom local.
    const candidate = pfsVariants.find((pv) => {
      const pvType = pv.type === "ITEM" ? "UNIT" : "PACK";
      if (pvType !== l.expected.type) return false;
      const pvRef =
        pv.item?.color.reference ??
        pv.packs?.[0]?.color.reference ??
        "";
      const pvKey = pfsVariantMatchKey(pv);
      // Ne pas voler une variante déjà associée à un autre local par ref.
      if (localByKey.has(pvKey) && pvKey !== key) return false;
      if (pfsLabelsMatched.has(pv.id)) return false;
      const pvLabelFr =
        pv.item?.color.labels?.fr ??
        pv.packs?.[0]?.color.labels?.fr ??
        "";
      if (!pvLabelFr) return false;
      return normalizeColorRef(pvLabelFr) === normLocalName && pvRef.length > 0;
    });
    if (candidate) {
      pfsByKey.set(key, candidate);
      pfsLabelsMatched.add(candidate.id);
      // Heal opportuniste : on aligne la ref locale sur celle de PFS.
      const pvRef =
        candidate.item?.color.reference ??
        candidate.packs?.[0]?.color.reference ??
        "";
      const localColorId = local.colors.find(
        (c) => c.color && normalizeColorRef(c.color.name) === normLocalName,
      )?.color?.id;
      const currentPfsRef =
        local.colors.find(
          (c) => c.color && normalizeColorRef(c.color.name) === normLocalName,
        )?.color?.pfsColorRef ?? null;
      if (localColorId && normalizeColorRef(currentPfsRef ?? "") !== normalizeColorRef(pvRef)) {
        opts.onColorAutoHeal?.({
          localColorId,
          localColorName: l.colorName,
          currentPfsRef,
          newPfsRef: pvRef,
        });
      }
    }
  }

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

  // 3) Variantes PFS orphelines → à retirer OU doublon PFS d'une variante
  //    déjà présente chez nous. Cas doublon reporté 2026-08-08 sur 13164FLEUR
  //    (Issyma) : PFS avait 2 variantes YELLOW pour ce produit. L'audit
  //    proposait à tort « Jaune sera ajoutée sur votre site » alors qu'il
  //    fallait juste supprimer le doublon côté PFS.
  //
  //    Précalcul : ensemble des (type, colorRef normalisé) des variantes PFS
  //    déjà matchées à un local. Une orpheline qui partage cette clé est un
  //    doublon PFS, pas une couleur nouvelle.
  const matchedPfsSignatures = new Set<string>();
  for (const pv of pfsVariants) {
    if (!seenPfsIds.has(pv.id)) continue;
    matchedPfsSignatures.add(pfsVariantMatchKey(pv));
  }
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
    const isDuplicate = matchedPfsSignatures.has(pfsVariantMatchKey(pv));
    if (isDuplicate) {
      issues.push({
        scope: "color",
        field: "duplicatePfsVariant",
        fieldLabel: `Variante ${labelForVariantType(type, null).toLowerCase()} en double sur PFS`,
        colorRef,
        colorName,
        colorHex,
        variantType: type,
        pfsVariantId: pv.id,
        pfsValue: null,
        expectedValue: null,
        note: `Doublon côté PFS pour la couleur « ${colorName} » : notre site est lié à une autre variante PFS. À supprimer côté PFS.`,
      });
      continue;
    }
    issues.push({
      scope: "color",
      field: "extraVariant",
      fieldLabel: `Variante ${labelForVariantType(type, null).toLowerCase()} en trop sur PFS`,
      colorRef,
      colorName,
      colorHex,
      variantType: type,
      pfsVariantId: pv.id,
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
 * Guérison automatique candidate : quand PFS renvoie une matière avec sa
 * vraie référence (ex: "COTTON") et que localement on a une composition
 * portant le bon libellé français ("Coton") mais un mauvais
 * `pfsCompositionRef` ("Coton"), on peut aligner sans intervention manuelle.
 * `verifyPfsProduct` applique ces guérisons après la compare.
 */
export interface CompositionAutoHealAction {
  localCompositionId: string;
  localName: string;
  currentPfsRef: string | null;
  newPfsRef: string;
  /** Si non-null : PFS a fourni un Salesforce Uid pour cette matière et
   *  la compo locale n'en a pas encore un — heal parallèle pour aligner
   *  définitivement la clé Uid (immunise l'audit aux futures fautes
   *  d'orthographe PFS). */
  newPfsUid?: string | null;
}

interface CompositionReconcileResult {
  /** Toutes les entrées PFS ont un équivalent local (par ref ou par nom)
   *  ET toutes les entrées locales ont un équivalent côté PFS ET les % correspondent. */
  aligned: boolean;
  /** Noms FR (labelMap) des matières PFS **absentes de la biblio locale** —
   *  vraie création requise, bloque le pull. */
  missingLocalNames: string[];
  /** Métadonnées PFS complètes des matières manquantes (Uid + Ref + suggested
   *  name + labels) — utilisé par l'UI pour proposer un raccourci « Créer cette
   *  composition » en 1 clic sans passer par l'apply. */
  missingLocalPfs: PfsMissingCompositionInfoLite[];
  /** Noms FR des matières PFS **présentes dans la biblio locale mais non
   *  rattachées à ce produit**. Le pull « Corriger depuis PFS » les rattachera
   *  automatiquement via `resolvePfsCompositionsToLocal` — non bloquant. */
  libraryOnlyNames: string[];
  /** Noms locaux des compositions sans équivalent PFS. */
  orphanLocalNames: string[];
  /** Guérisons à appliquer si aligned=true. */
  heals: CompositionAutoHealAction[];
}

/**
 * Tente de réconcilier compositions locales et PFS quand les signatures
 * `REF:pct|REF:pct` ne matchent pas :
 *  1. Match par Salesforce Uid (le plus fiable — immunisé aux orthographes).
 *  2. Match direct par ref normalisée (ex: "Acier inoxydable" ↔ "ACIERINOXYDABLE").
 *  3. Fallback : match par libellé FR PFS (ex: "COTTON" ↔ "Coton") — utilisé
 *     quand `Composition.pfsCompositionRef` local a été mal stocké
 *     (bug d'import historique).
 *
 * Ne crée jamais de composition locale. Si PFS a une matière absente du
 * catalogue local, on la signale — l'admin doit la créer manuellement.
 *
 * Pose aussi un `newPfsUid` sur les heals quand PFS renvoie un Uid et
 * que le local n'en a pas — permet de basculer progressivement toutes les
 * compos existantes sur la clé Uid stable.
 */
function reconcileCompositionsByLabel(
  local: FullProduct["compositions"],
  pfs: Array<{ id?: string; reference: string; percentage: number; labels?: Record<string, string> }>,
  compositionLabelByRef: Map<string, string> | undefined,
  library?: CompositionLibraryIndex,
): CompositionReconcileResult {
  // Normalisation nom pour matching : sans accents, sans espaces, uppercase.
  const normName = (s: string): string => normalizeCompositionRef(s);

  // Index local : par Uid (priorité 1), par ref (priorité 2), par nom.
  interface LocalEntry {
    id: string | undefined;
    name: string;
    ref: string | null;
    uid: string | null;
    normRef: string | null;
    normName: string;
    pct: number;
    consumed: boolean;
  }
  const locals: LocalEntry[] = local.map((c) => ({
    id: c.composition.id,
    name: c.composition.name,
    ref: c.composition.pfsCompositionRef,
    uid: c.composition.pfsCompositionUid ?? null,
    normRef: c.composition.pfsCompositionRef ? normalizeCompositionRef(c.composition.pfsCompositionRef) : null,
    normName: normName(c.composition.name),
    pct: Number(c.percentage),
    consumed: false,
  }));

  const heals: CompositionAutoHealAction[] = [];
  const missingLocalNames: string[] = [];
  const missingLocalPfs: PfsMissingCompositionInfoLite[] = [];
  const libraryOnlyNames: string[] = [];

  for (const pfsEntry of pfs) {
    const normPfsRef = normalizeCompositionRef(pfsEntry.reference);
    const pfsFrLabel =
      pfsEntry.labels?.fr?.trim() || compositionLabelByRef?.get(normPfsRef) || pfsEntry.reference;
    const normPfsLabel = normName(pfsFrLabel);

    // Étape 1 : match par Uid Salesforce (le plus stable)
    let match = pfsEntry.id ? locals.find((l) => !l.consumed && l.uid === pfsEntry.id) : undefined;
    // Étape 2 : match direct par ref (Code PFS)
    if (!match) {
      match = locals.find((l) => !l.consumed && l.normRef === normPfsRef);
    }
    // Étape 3 : match par nom (le libellé FR PFS matche le nom local)
    if (!match) {
      match = locals.find((l) => !l.consumed && l.normName === normPfsLabel);
    }

    if (!match) {
      // Avant de déclarer « manquant / création requise », on vérifie si la
      // biblio Composition du tenant contient déjà cette matière (par Uid,
      // ref ou nom FR normalisé). Si oui, le pull « Corriger depuis PFS »
      // la rattachera automatiquement via `resolvePfsCompositionsToLocal` —
      // on ne doit pas bloquer sur un faux « à créer » (bug reporté 2026-08-07
      // par la cliente pour Laine · Viscose · Nylon sur Issyma, alors que
      // les 3 compos existaient bien dans Paramètres > Compositions).
      const inLibrary =
        !!library &&
        ((pfsEntry.id && library.uids.has(pfsEntry.id)) ||
          library.refs.has(normPfsRef) ||
          library.names.has(normPfsLabel));
      if (inLibrary) {
        libraryOnlyNames.push(pfsFrLabel);
        continue;
      }
      missingLocalNames.push(pfsFrLabel);
      // Métadonnées complètes pour raccourci UI (create-in-1-click).
      const dedupKey = pfsEntry.id || pfsEntry.reference || pfsFrLabel;
      if (!missingLocalPfs.some((m) => (m.pfsUid || m.pfsRef) === dedupKey)) {
        missingLocalPfs.push({
          pfsUid: pfsEntry.id || "",
          pfsRef: pfsEntry.reference,
          suggestedName: pfsFrLabel,
          labels: pfsEntry.labels ?? {},
        });
      }
      continue;
    }
    match.consumed = true;
    // % différent → pas alignable, on renvoie tout de même les autres matchs
    // (pour info), mais la compare finale re-fera un diff standard.
    if (Number(match.pct) !== Number(pfsEntry.percentage)) {
      // On marque un pseudo-heal invalide pour signaler l'écart de %.
      // Le caller détectera aligned=false et n'appliquera rien.
      // Simple : on ne heal pas, on laisse le sig diff normal remonter.
      // Aucune action ici.
    } else if (match.id && (match.normRef !== normPfsRef || (pfsEntry.id && !match.uid))) {
      heals.push({
        localCompositionId: match.id,
        localName: match.name,
        currentPfsRef: match.ref,
        newPfsRef: pfsEntry.reference,
        newPfsUid: pfsEntry.id && !match.uid ? pfsEntry.id : null,
      });
    }
  }

  const orphanLocalNames = locals.filter((l) => !l.consumed).map((l) => l.name);
  const pctMismatch = locals.some((l) => {
    if (!l.consumed) return false;
    const pfsMatch = pfs.find((p) => {
      const normPfsRef = normalizeCompositionRef(p.reference);
      if (l.normRef === normPfsRef) return true;
      const pfsFrLabel =
        p.labels?.fr?.trim() || compositionLabelByRef?.get(normPfsRef) || p.reference;
      return normName(pfsFrLabel) === l.normName;
    });
    return pfsMatch != null && Number(pfsMatch.percentage) !== Number(l.pct);
  });

  const aligned =
    missingLocalNames.length === 0 &&
    libraryOnlyNames.length === 0 &&
    orphanLocalNames.length === 0 &&
    !pctMismatch;

  return { aligned, missingLocalNames, missingLocalPfs, libraryOnlyNames, orphanLocalNames, heals };
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
    // NEW = produit PFS créé mais jamais activé (invisible en vitrine PFS).
    // Traité comme ARCHIVED côté BJ — libellé harmonisé pour éviter toute
    // ambiguïté dans le modal (défensif : la comparaison normalise déjà
    // NEW → ARCHIVED avant d'appeler ce libellé).
    case "NEW": return "Archivé";
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
  context?: PfsVerifyContext,
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

  // Fallback API admin (mobile PFS) : le wholesaler renvoie parfois compo
  // vide alors que le vendeur l'a saisie via l'appli mobile (bug de synchro
  // côté PFS). On enrichit checkRef.product.material_composition en place
  // pour que comparePfsProduct voie la vraie compo.
  if ((checkRef.product.material_composition ?? []).length === 0 && checkRef.product.id) {
    const fallback = await pfsAdminFetchMaterialComposition(checkRef.product.id).catch((err) => {
      logger.warn("[PFS Verify] Fallback composition (API admin) échoué", {
        pfsProductId: checkRef.product!.id,
        reference: product.reference,
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as Awaited<ReturnType<typeof pfsAdminFetchMaterialComposition>>;
    });
    if (fallback.length > 0) {
      checkRef.product.material_composition = fallback;
      logger.info("[PFS Verify] Composition enrichie via API admin", {
        pfsProductId: checkRef.product.id,
        reference: product.reference,
        count: fallback.length,
      });
    }
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

  // 3) Mapping couleurs + markup + labels PFS pour l'affichage humain.
  // Réutilise le contexte préchargé si fourni (audit en lot / bulk verify) —
  // évite 5 HTTP + 2 BDD redondants par produit.
  const ctx = context ?? (await loadPfsVerifyContext());

  // Collecte les auto-guérisons de `pfsCompositionRef` détectées pendant la
  // compare (matières identiques par nom mais mauvais code PFS local, ex :
  // "Coton" ↔ "COTTON"). Appliquées après la compare pour ne pas mélanger
  // une mutation dans le flux de calcul.
  const compositionHeals: CompositionAutoHealAction[] = [];
  const colorHeals: ColorAutoHealAction[] = [];

  const issues = comparePfsProduct(
    product,
    checkRef.product,
    variantsResp.data ?? [],
    ctx.colorRefMap,
    {
      pfsMarkup: ctx.pfsMarkup,
      labels: ctx.labels,
      compositionLibrary: ctx.compositionLibrary,
      onCompositionAutoHeal: (heal) => {
        compositionHeals.push(heal);
      },
      onColorAutoHeal: (heal) => {
        colorHeals.push(heal);
      },
    },
  );

  if (compositionHeals.length > 0) {
    await Promise.allSettled(
      compositionHeals.map(async (heal) => {
        // Anti-collision : si une AUTRE composition du tenant porte déjà la
        // vraie ref PFS (ex: doublon historique), on ne l'écrase pas — on
        // laissera l'admin fusionner manuellement.
        const collision = await prisma.composition.findFirst({
          where: { pfsCompositionRef: heal.newPfsRef, NOT: { id: heal.localCompositionId } },
          select: { id: true, name: true },
        });
        if (collision) {
          logger.warn("[PFS Verify] Auto-heal skippé (collision de ref)", {
            productReference: product.reference,
            localName: heal.localName,
            targetRef: heal.newPfsRef,
            collidesWithId: collision.id,
            collidesWithName: collision.name,
          });
          return;
        }
        await prisma.composition.update({
          where: { id: heal.localCompositionId },
          data: {
            pfsCompositionRef: heal.newPfsRef,
            ...(heal.newPfsUid ? { pfsCompositionUid: heal.newPfsUid } : {}),
          },
        });
        logger.info("[PFS Verify] Auto-guérison pfsCompositionRef", {
          productReference: product.reference,
          localName: heal.localName,
          oldRef: heal.currentPfsRef,
          newRef: heal.newPfsRef,
          newUid: heal.newPfsUid ?? null,
        });
      }),
    );
  }

  if (colorHeals.length > 0) {
    await Promise.allSettled(
      colorHeals.map(async (heal) => {
        // Anti-collision : si une autre Color du tenant porte déjà cette ref
        // PFS, on ne l'écrase pas (garde-fou mapping couleurs marketplaces —
        // c36b5518). L'admin gérera manuellement.
        const collision = await prisma.color.findFirst({
          where: { pfsColorRef: heal.newPfsRef, NOT: { id: heal.localColorId } },
          select: { id: true, name: true },
        });
        if (collision) {
          logger.warn("[PFS Verify] Auto-heal couleur skippé (collision)", {
            productReference: product.reference,
            localName: heal.localColorName,
            targetRef: heal.newPfsRef,
            collidesWithId: collision.id,
            collidesWithName: collision.name,
          });
          return;
        }
        await prisma.color.update({
          where: { id: heal.localColorId },
          data: { pfsColorRef: heal.newPfsRef },
        });
        logger.info("[PFS Verify] Auto-guérison Color.pfsColorRef", {
          productReference: product.reference,
          localName: heal.localColorName,
          oldRef: heal.currentPfsRef,
          newRef: heal.newPfsRef,
        });
      }),
    );
  }

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

/**
 * Snapshot des biblios Composition/Color du tenant courant (extension Prisma
 * scope auto). Loadé une fois par `loadPfsVerifyContext`, réutilisé pour tout
 * le lot d'audit — évite N requêtes en bulk.
 */
async function buildCompositionLibraryIndex(): Promise<CompositionLibraryIndex> {
  const uids = new Set<string>();
  const refs = new Set<string>();
  const names = new Set<string>();
  try {
    const rows = await prisma.composition.findMany({
      select: { name: true, pfsCompositionRef: true, pfsCompositionUid: true },
    });
    for (const r of rows) {
      if (r.pfsCompositionUid) uids.add(r.pfsCompositionUid);
      if (r.pfsCompositionRef) refs.add(normalizeCompositionRef(r.pfsCompositionRef));
      if (r.name) names.add(normalizeCompositionRef(r.name));
    }
  } catch (err) {
    logger.warn("[PFS Verify] Failed to load Composition library", { error: err });
  }
  return { uids, refs, names };
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

/**
 * Précharge en parallèle les 5 tables globales PFS + 2 configs BDD partagées
 * par tous les `verifyPfsProduct` d'un même lot. À appeler UNE FOIS au début
 * d'un audit / bulk verify puis à passer à chaque `verifyPfsProduct`.
 */
export async function loadPfsVerifyContext(): Promise<PfsVerifyContext> {
  const [colorRefMap, markupConfigs, labelMaps, compositionLibrary] = await Promise.all([
    buildColorLabelToRefMap(),
    loadMarketplaceMarkupConfigs(),
    buildPfsLabelMaps(),
    buildCompositionLibraryIndex(),
  ]);
  return {
    colorRefMap,
    pfsMarkup: markupConfigs.pfs,
    labels: labelMaps,
    compositionLibrary,
  };
}
