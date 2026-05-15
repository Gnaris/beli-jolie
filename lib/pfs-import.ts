/**
 * PFS Import — Logique métier
 *
 * Parcours en 3 étapes :
 *   1. Collecte les attributs PFS utilisés par le catalogue + vérifie s'ils sont mappés chez nous
 *   2. Liste les produits PFS dont la référence n'existe pas encore chez nous
 *   3. Approbation d'un produit : création immédiate en statut SYNCING, puis
 *      téléchargement des images en arrière-plan (SYNCING → OFFLINE une fois prêt)
 */

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  pfsListProducts,
  pfsCheckReference,
  pfsGetVariants,
  type PfsProduct,
  type PfsVariantItem,
  type PfsColorInfo,
} from "@/lib/pfs-api";
import { getCachedPfsProductById } from "@/lib/pfs-list-cache";
import { pfsGetCategories, pfsGetFamilies, type PfsAttributeCategory } from "@/lib/pfs-api-write";
import { processProductImage } from "@/lib/image-processor";
import { productImageDir, productImageBaseName, deleteDirectory } from "@/lib/storage";
import { emitProductEvent } from "@/lib/product-events";
import { generateSku } from "@/lib/sku";
import {
  autoTranslateCategory,
  autoTranslateColor,
  autoTranslateComposition,
  autoTranslateManufacturingCountry,
  autoTranslateProduct,
  autoTranslateSeason,
} from "@/lib/auto-translate";
import {
  PFS_FAMILIES_BY_GENDER,
  PFS_GENDER_LABELS,
  PFS_SUBCATEGORIES_BY_FAMILY,
} from "@/lib/marketplace-excel/pfs-taxonomy";
import {
  sanitizePfsFamilyName,
  inferPfsFamilyFromCategoryLabel,
} from "@/lib/pfs-family-resolve";
import { PROTECTED_SIZE_NAME, PROTECTED_SIZE_PFS_REF, isProtectedSizeName } from "@/lib/protected-sizes";
import { requirePfsBrand } from "@/lib/pfs-brand";

// Re-export pour ne pas casser les imports existants de `pfs-import`.
export { sanitizePfsFamilyName, inferPfsFamilyFromCategoryLabel };

// ─────────────────────────────────────────────
// Types exportés
// ─────────────────────────────────────────────

export type PfsAttributeType =
  | "category"
  | "color"
  | "composition"
  | "country"
  | "season"
  | "size";

export interface PfsAttribute {
  type: PfsAttributeType;
  pfsRef: string;
  label: string;
  /** Libellé EN extrait directement de PFS — null si PFS ne l'a pas. Utilisé
   *  pour sauter DeepL au moment de la création locale de l'attribut. */
  enLabel?: string | null;
  mapped: boolean;
  localId?: string;
  localName?: string;
  /**
   * Infos complémentaires renvoyées selon le type d'attribut :
   *  - catégorie : genre / famille / sous-catégorie PFS (cascade complète)
   *  - couleur : code hex officiel PFS pour pré-remplir l'aperçu de couleur
   */
  meta?: {
    pfsGender?: string | null;
    pfsFamilyName?: string | null;
    pfsCategoryName?: string | null;
    /** Code hex PFS (#RRGGBB) — rempli pour le type "color" uniquement. */
    hex?: string | null;
    /** Code ISO pays (ex: "CN") — rempli pour le type "country" uniquement. */
    isoCode?: string | null;
  };
}

export interface PfsAttributeScan {
  attributes: PfsAttribute[];
  scannedProducts: number;
  deepScannedProducts: number;
}

export interface ImportablePfsProduct {
  pfsId: string;
  reference: string;
  name: string;
  category: string;
  family: string;
  colorCount: number;
  variantCount: number;
  defaultImage: string | null;
}

/** Erreur levée quand l'import a été annulé par l'utilisateur en cours de route. */
export class PfsImportCancelledError extends Error {
  constructor(message = "Import annulé") {
    super(message);
    this.name = "PfsImportCancelledError";
  }
}

export interface ImportCancellationOptions {
  /** Callback synchrone : retourne true si l'import doit être interrompu. */
  isCancelled?: () => boolean;
}

function throwIfCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new PfsImportCancelledError();
}

// ─────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────

const PFS_LIST_PAGE_SIZE = 100;
const DEEP_SCAN_SAMPLE_SIZE = 50; // nb de produits inspectés en profondeur (checkReference) pour composition / pays / saison

/**
 * Convertit le statut texte renvoyé par PFS en statut local boutique.
 * READY_FOR_SALE = produit visible côté clients PFS → on met ONLINE chez nous.
 * Tout le reste (DRAFT, NEW, ARCHIVED, DELETED, …) → OFFLINE par sécurité.
 * La comparaison est insensible à la casse / aux espaces.
 */
export function pfsStatusToBjStatus(
  pfsStatus: string | null | undefined,
): "ONLINE" | "OFFLINE" {
  if (typeof pfsStatus !== "string") return "OFFLINE";
  return pfsStatus.trim().toUpperCase() === "READY_FOR_SALE" ? "ONLINE" : "OFFLINE";
}

/**
 * Force OFFLINE quand au moins une couleur du produit n'a aucune image
 * téléchargée. Cohérent avec la règle de validation du formulaire admin :
 * un produit en ligne doit avoir au moins une photo par couleur.
 */
export function applyMissingImageDowngrade(
  initialStatus: "ONLINE" | "OFFLINE",
  variantColorIds: readonly string[],
  imageColorIds: readonly string[],
): { status: "ONLINE" | "OFFLINE"; missingColorIds: string[] } {
  const wanted = new Set(variantColorIds);
  const have = new Set(imageColorIds);
  const missing = [...wanted].filter((cid) => !have.has(cid));
  if (initialStatus === "ONLINE" && missing.length > 0) {
    return { status: "OFFLINE", missingColorIds: missing };
  }
  return { status: initialStatus, missingColorIds: missing };
}

/** Traduction des codes pays courants en noms français */
const COUNTRY_LABELS_FR: Record<string, string> = {
  CN: "Chine", FR: "France", IT: "Italie", ES: "Espagne", DE: "Allemagne",
  TR: "Turquie", PT: "Portugal", IN: "Inde", BD: "Bangladesh", VN: "Vietnam",
  MA: "Maroc", TN: "Tunisie", PK: "Pakistan", TH: "Thaïlande", GB: "Royaume-Uni",
  US: "États-Unis", BE: "Belgique", NL: "Pays-Bas", PL: "Pologne", RO: "Roumanie",
  GR: "Grèce", BG: "Bulgarie", KH: "Cambodge", MM: "Myanmar", LK: "Sri Lanka",
  EG: "Égypte", JP: "Japon", KR: "Corée du Sud", TW: "Taïwan", ID: "Indonésie",
  MX: "Mexique", BR: "Brésil", CZ: "Tchéquie", HU: "Hongrie", AT: "Autriche",
  CH: "Suisse", DK: "Danemark", SE: "Suède", FI: "Finlande", NO: "Norvège",
  IE: "Irlande", HR: "Croatie", SK: "Slovaquie", SI: "Slovénie", LT: "Lituanie",
  LV: "Lettonie", EE: "Estonie", AL: "Albanie", RS: "Serbie", UA: "Ukraine",
  MD: "Moldavie", ET: "Éthiopie", MG: "Madagascar", MU: "Maurice", SN: "Sénégal",
};

/** Traduction des codes pays courants en noms anglais (évite un appel DeepL). */
const COUNTRY_LABELS_EN: Record<string, string> = {
  CN: "China", FR: "France", IT: "Italy", ES: "Spain", DE: "Germany",
  TR: "Turkey", PT: "Portugal", IN: "India", BD: "Bangladesh", VN: "Vietnam",
  MA: "Morocco", TN: "Tunisia", PK: "Pakistan", TH: "Thailand", GB: "United Kingdom",
  US: "United States", BE: "Belgium", NL: "Netherlands", PL: "Poland", RO: "Romania",
  GR: "Greece", BG: "Bulgaria", KH: "Cambodia", MM: "Myanmar", LK: "Sri Lanka",
  EG: "Egypt", JP: "Japan", KR: "South Korea", TW: "Taiwan", ID: "Indonesia",
  MX: "Mexico", BR: "Brazil", CZ: "Czechia", HU: "Hungary", AT: "Austria",
  CH: "Switzerland", DK: "Denmark", SE: "Sweden", FI: "Finland", NO: "Norway",
  IE: "Ireland", HR: "Croatia", SK: "Slovakia", SI: "Slovenia", LT: "Lithuania",
  LV: "Latvia", EE: "Estonia", AL: "Albania", RS: "Serbia", UA: "Ukraine",
  MD: "Moldova", ET: "Ethiopia", MG: "Madagascar", MU: "Mauritius", SN: "Senegal",
};

function countryLabel(code: string): string {
  const upper = code.trim().toUpperCase();
  return COUNTRY_LABELS_FR[upper] ?? code;
}

/** Libellé EN d'un pays à partir d'un code ISO. Renvoie null si inconnu. */
function countryLabelEn(code: string | null | undefined): string | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return COUNTRY_LABELS_EN[upper] ?? null;
}

/**
 * Retrouve le code genre PFS (WOMAN / MAN / KID / SUPPLIES) pour une famille
 * donnée en parcourant la table `PFS_FAMILIES_BY_GENDER`. Renvoie null si la
 * famille n'apparaît pas (= catégorie en dehors du référentiel PFS officiel).
 */
export function inferPfsGenderFromFamily(family: string | null | undefined): string | null {
  if (!family) return null;
  for (const [genderLabel, families] of Object.entries(PFS_FAMILIES_BY_GENDER)) {
    if (families.includes(family)) {
      const codeEntry = Object.entries(PFS_GENDER_LABELS).find(([, label]) => label === genderLabel);
      return codeEntry?.[0] ?? null;
    }
  }
  return null;
}

/**
 * Normalise un genre brut venant de PFS (`prod.gender`, `PfsAttributeCategory.gender`)
 * vers le code canonique utilisé dans `PFS_GENDER_LABELS` ("WOMAN", "MAN", …).
 * Accepte soit le code lui-même, soit le libellé FR ("Femme"), soit des
 * abréviations courantes renvoyées parfois par PFS (F/H/E/K/L).
 */
export function normalizePfsGenderCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (!upper) return null;
  if (PFS_GENDER_LABELS[upper]) return upper;
  for (const [code, label] of Object.entries(PFS_GENDER_LABELS)) {
    if (label.toLocaleUpperCase("fr-FR") === upper) return code;
  }
  const abbrev: Record<string, string> = {
    F: "WOMAN", W: "WOMAN", FEMME: "WOMAN",
    H: "MAN", M: "MAN", HOMME: "MAN",
    E: "KID", K: "KID", ENFANT: "KID",
    L: "SUPPLIES", S: "SUPPLIES", LIFESTYLE: "SUPPLIES",
  };
  return abbrev[upper] ?? null;
}

/** Extrait le libellé EN d'un objet `labels` PFS (ou null si absent). PFS
 *  peut renvoyer `en`, `EN`, `en_US`, `EN_US`, `en-GB`… on accepte tout. */
function pickEnLabel(labels: Record<string, string> | null | undefined): string | null {
  if (!labels) return null;
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const normalized = k.toLowerCase().replace(/[-_]/g, "");
    if (normalized === "en" || normalized === "enus" || normalized === "engb") {
      return v.trim();
    }
  }
  return null;
}

/** Extrait le meilleur libellé humain possible d'un objet `labels` PFS. */
function pickBestLabel(labels: Record<string, string> | null | undefined): string | null {
  if (!labels) return null;
  const ordered = ["fr", "fr_FR", "en", "en_US", "en_GB"];
  for (const k of ordered) {
    const v = labels[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const v of Object.values(labels)) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Vérifie que la sous-catégorie (label FR renvoyé par PFS) fait bien partie
 * des sous-catégories connues pour la famille — sinon on ne pré-remplit pas
 * pour ne pas saisir une valeur hors référentiel.
 */
export function validatedPfsCategoryName(
  family: string | null | undefined,
  catLabel: string | null | undefined,
): string | null {
  if (!family || !catLabel) return null;
  const known = PFS_SUBCATEGORIES_BY_FAMILY[family] ?? [];
  return known.includes(catLabel) ? catLabel : null;
}

export type ImportCategoryRow = { id: string; name: string };
export type ImportCategoryMatch = "pfsCategoryId" | "pfsFamilyName" | "name";

/**
 * Choisit la catégorie locale à associer à un produit importé depuis PFS,
 * dans cet ordre de priorité :
 *  1. Match exact par `pfsCategoryId` (cas nominal)
 *  2. Repli par `pfsFamilyName` (mapping via la famille parente PFS)
 *  3. Repli par nom local (`Category.name` = libellé FR/EN du produit PFS)
 *
 * Le 3e cas couvre les **doublons PFS** : PFS expose parfois deux IDs pour la
 * même catégorie (ex: deux "Blouses"). La cliente a mappé la version active,
 * mais des produits anciens reviennent avec l'ID obsolète. Le repli par nom
 * permet de raccrocher quand même.
 */
export function pickImportCategory(
  primary: ImportCategoryRow | null,
  familyFallback: ImportCategoryRow | null,
  nameFallback: ImportCategoryRow | null,
): { category: ImportCategoryRow | null; matchedBy: ImportCategoryMatch | null } {
  if (primary) return { category: primary, matchedBy: "pfsCategoryId" };
  if (familyFallback) return { category: familyFallback, matchedBy: "pfsFamilyName" };
  if (nameFallback) return { category: nameFallback, matchedBy: "name" };
  return { category: null, matchedBy: null };
}


function firstStringImage(img: string | string[] | undefined | null): string | null {
  if (!img) return null;
  if (Array.isArray(img)) return img[0] ?? null;
  return img;
}

/**
 * Récupère l'image "DEFAUT" (si présente) d'un produit PFS, sinon la première image trouvée.
 * Pas de cache : l'URL PFS est renvoyée telle quelle pour affichage direct.
 */
/**
 * Construit la liste ordonnée des noms à essayer pour matcher une couleur PFS
 * avec une entrée de la bibliothèque locale (`Color.name`). PFS envoie un code
 * anglais en majuscules (ex: "DARK_GRAY") + des libellés traduits dans
 * `labels` (fr, en, de, es, it). Les couleurs locales sont en français, donc
 * on essaie les libellés avant de retomber sur le code brut.
 *
 * Ordre de priorité : labels.fr → labels.en → labels.de → labels.es →
 * labels.it → reference. Doublons supprimés.
 */
export function pfsColorMatchCandidates(c: {
  reference: string;
  labels?: Record<string, string> | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string | undefined | null) => {
    if (!v) return;
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  const labels = c.labels ?? {};
  for (const lang of ["fr", "en", "de", "es", "it"]) {
    push(labels[lang]);
  }
  push(c.reference);
  return out;
}

/**
 * Fusionne les entrées de tailles qui partagent le même sizeId en additionnant
 * leurs quantités. Nécessaire pour les packs multi-couleurs PFS où la même
 * taille peut apparaître via plusieurs lignes de pack (ex: Rouge M + Bleu M).
 * Sans dédoublonnage, le createMany sur VariantSize échoue sur la contrainte
 * unique (productColorId, sizeId).
 */
export function dedupeSizeEntries(
  entries: { sizeId: string; quantity: number }[],
): { sizeId: string; quantity: number }[] {
  const merged = new Map<string, number>();
  for (const e of entries) {
    merged.set(e.sizeId, (merged.get(e.sizeId) ?? 0) + e.quantity);
  }
  return Array.from(merged, ([sizeId, quantity]) => ({ sizeId, quantity }));
}

/**
 * À partir des lignes de packs PFS déjà résolues (sizeId/colorId trouvés en
 * BDD), construit la structure adaptée au schéma local :
 *   - 1 seule couleur distincte → PACK mono-couleur (sizeEntries fusionnés,
 *     packLines vide).
 *   - 2+ couleurs distinctes → PACK multi-couleurs (1 PackColorLine par
 *     couleur, sizeEntries vide). Les lignes de la même couleur sont
 *     fusionnées (pour les rares cas où PFS répète une couleur dans `packs`).
 *
 * Conserve l'ordre d'apparition des couleurs dans la réponse PFS — c'est cet
 * ordre qui détermine la "couleur principale" du variant local.
 */
export function buildPackLinesFromResolved(
  resolvedPacks: { colorId: string; sizeEntries: { sizeId: string; quantity: number }[] }[],
): {
  sizeEntries: { sizeId: string; quantity: number }[];
  packLines: { colorId: string; sizeEntries: { sizeId: string; quantity: number }[] }[];
  allColorIds: string[];
} {
  if (resolvedPacks.length === 0) {
    return { sizeEntries: [], packLines: [], allColorIds: [] };
  }

  type Bucket = {
    sizeEntries: { sizeId: string; quantity: number }[];
    firstSeenIndex: number;
  };
  const byColor = new Map<string, Bucket>();
  resolvedPacks.forEach((p, idx) => {
    const existing = byColor.get(p.colorId);
    if (existing) {
      existing.sizeEntries.push(...p.sizeEntries);
    } else {
      byColor.set(p.colorId, { sizeEntries: [...p.sizeEntries], firstSeenIndex: idx });
    }
  });

  if (byColor.size === 1) {
    // PACK mono-couleur (éventuellement réparti sur plusieurs `packs[]` PFS) :
    // on fusionne tout dans sizeEntries, pas de packLines.
    const onlyColorId = byColor.keys().next().value as string;
    const onlyBucket = byColor.get(onlyColorId)!;
    return {
      sizeEntries: dedupeSizeEntries(onlyBucket.sizeEntries),
      packLines: [],
      allColorIds: [onlyColorId],
    };
  }

  // PACK multi-couleurs : 1 PackColorLine par couleur, ordre PFS préservé.
  const sortedEntries = Array.from(byColor.entries()).sort(
    ([, a], [, b]) => a.firstSeenIndex - b.firstSeenIndex,
  );
  const packLines = sortedEntries.map(([colorId, bucket]) => ({
    colorId,
    sizeEntries: dedupeSizeEntries(bucket.sizeEntries),
  }));
  return {
    sizeEntries: [],
    packLines,
    allColorIds: packLines.map((l) => l.colorId),
  };
}

export function pickDefaultImage(images: Record<string, string | string[]> | null | undefined): string | null {
  if (!images) return null;
  const defaut = images["DEFAUT"] ?? images["DEFAULT"] ?? images["default"];
  const first = firstStringImage(defaut);
  if (first) return first;
  for (const key of Object.keys(images)) {
    const v = firstStringImage(images[key]);
    if (v) return v;
  }
  return null;
}

function splitSizesString(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Normalise une chaîne pour comparaison de clés d'images (majuscules, sans accents) */
function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * PFS renvoie souvent les URLs d'images avec `?image_process=resize,w_450`
 * (ou autres transformations type quality/format). Pour le téléchargement,
 * on veut TOUJOURS la version originale pleine résolution → on retire la query
 * entière. Idempotent : retourne l'URL telle quelle si pas de query.
 */
export function stripPfsImageProcessQuery(url: string): string {
  if (!url) return url;
  const idx = url.indexOf("?");
  return idx === -1 ? url : url.slice(0, idx);
}

/**
 * Extrait les images d'un objet `Record<clé, url|url[]>` pour des couleurs données.
 * Compare la clé à la référence PFS (ex: "GOLDEN") et au label localisé (ex: "Doré"),
 * sans sensibilité à la casse ni aux accents.
 * Ne collecte JAMAIS les clés génériques ("DEFAUT", "DEFAULT") — elles ne sont pas
 * spécifiques à une couleur et produiraient la même image sur chaque variante.
 * Les URLs sont nettoyées de leur query `?image_process=...` pour récupérer la pleine
 * résolution (cf. stripPfsImageProcessQuery).
 */
export function collectImagesForColors(
  source: Record<string, string | string[]> | null | undefined,
  colors: PfsColorInfo[],
): string[] {
  if (!source) return [];
  const wanted = new Set<string>();
  for (const col of colors) {
    if (col?.reference) wanted.add(normalizeKey(col.reference));
    const labels = col?.labels ?? {};
    for (const label of Object.values(labels)) {
      if (label) wanted.add(normalizeKey(label));
    }
  }
  if (wanted.size === 0) return [];
  const out: string[] = [];
  for (const key of Object.keys(source)) {
    if (!wanted.has(normalizeKey(key))) continue;
    const val = source[key];
    if (Array.isArray(val)) {
      for (const u of val) {
        if (u) out.push(stripPfsImageProcessQuery(u));
      }
    } else if (val) {
      out.push(stripPfsImageProcessQuery(val));
    }
  }
  return out;
}

/**
 * Construit la liste d'images à charger pour une variante PFS, groupée par
 * couleur locale. Pour chaque couple (colorId local, couleur PFS) :
 *   1) on essaie d'abord les images portées par la variante (`variantImages`),
 *   2) si rien ne matche, on retombe sur `productImages` pour cette couleur.
 * URLs dédoublonnées par groupe. Aucun fallback "DEFAUT" / "première image"
 * pour ne jamais mélanger les photos entre couleurs.
 */
export function buildVariantImagesByColor(
  colorPairs: { localColorId: string; pfsColor: PfsColorInfo }[],
  variantImages: Record<string, string | string[]> | null | undefined,
  productImages: Record<string, string | string[]> | null | undefined,
): { colorId: string; urls: string[] }[] {
  return colorPairs.map(({ localColorId, pfsColor }) => {
    const scope: PfsColorInfo[] = [pfsColor];
    const fromVariant = collectImagesForColors(variantImages, scope);
    const urls = fromVariant.length > 0
      ? fromVariant
      : collectImagesForColors(productImages, scope);
    return { colorId: localColorId, urls: [...new Set(urls)] };
  });
}

/**
 * Planifie le téléchargement des images pour un ensemble de variantes
 * importées. Une image n'est plannifiée qu'une fois par colorId — si une
 * même couleur apparaît dans plusieurs variantes (ex: même couleur en UNIT
 * et PACK, ou Kaki présent dans 2 packs), on ne charge ses photos qu'une
 * fois et on les rattache à la première variante rencontrée. Les `order`
 * sont consécutifs par couleur (0,1,2…) pour respecter la contrainte unique
 * `(productId, colorId, order)` côté BDD.
 */
export interface PlannedImage {
  variantId: string;
  colorId: string;
  url: string;
  order: number;
}
export function planVariantImageDownloads(
  variants: { id: string; imagesByColor: { colorId: string; urls: string[] }[] }[],
): PlannedImage[] {
  const planned: PlannedImage[] = [];
  const seenByColor = new Map<string, Set<string>>();
  const variantForColor = new Map<string, string>();
  const orderByColor = new Map<string, number>();
  for (const v of variants) {
    for (const group of v.imagesByColor) {
      if (!variantForColor.has(group.colorId)) {
        variantForColor.set(group.colorId, v.id);
      }
      if (!seenByColor.has(group.colorId)) {
        seenByColor.set(group.colorId, new Set());
      }
      const seen = seenByColor.get(group.colorId)!;
      const targetVariantId = variantForColor.get(group.colorId)!;
      for (const url of group.urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        const nextOrder = orderByColor.get(group.colorId) ?? 0;
        planned.push({ variantId: targetVariantId, colorId: group.colorId, url, order: nextOrder });
        orderByColor.set(group.colorId, nextOrder + 1);
      }
    }
  }
  return planned;
}

function uniqueMap<T>(arr: T[], keyFn: (x: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of arr) {
    const k = keyFn(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return Array.from(seen.values());
}

/** Filtre les produits PFS pour ne garder que ceux pas encore dans notre DB */
async function filterImportable(products: PfsProduct[]): Promise<PfsProduct[]> {
  const refs = products.map((p) => p.reference.trim().toUpperCase());
  const existing = await prisma.product.findMany({
    where: { reference: { in: refs } },
    select: { reference: true },
  });
  const existingSet = new Set(existing.map((e) => e.reference));
  return products.filter((p) => !existingSet.has(p.reference.trim().toUpperCase()));
}

// ─────────────────────────────────────────────
// 1 — Collecte des attributs utilisés
// ─────────────────────────────────────────────

/**
 * Parcourt TOUTES les pages listProducts puis un échantillon checkReference
 * pour extraire les attributs uniques (catégorie, famille, couleurs, tailles,
 * composition, pays, saison).
 */
export async function scanPfsAttributes(options?: {
  maxImportable?: number;
  deepSampleSize?: number;
  /** When provided, only scan these specific references (by-reference import mode). */
  references?: string[];
}): Promise<PfsAttributeScan> {
  const maxImportable = options?.maxImportable;
  const deepSampleSize = options?.deepSampleSize ?? DEEP_SCAN_SAMPLE_SIZE;
  const targetRefs = options?.references?.map((r) => r.trim().toUpperCase());

  // Marque PFS obligatoire : on filtre côté API pour ne descendre QUE les
  // produits de la marque sélectionnée dans Paramètres.
  const pfsBrand = await requirePfsBrand();
  const brandId = pfsBrand.id;

  let products: PfsProduct[];

  if (targetRefs && targetRefs.length > 0) {
    // By-reference mode: load pages until we find all target references
    const targetSet = new Set(targetRefs);
    const found: PfsProduct[] = [];
    const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE, brandId);
    const totalPages = first.meta?.last_page ?? 1;

    for (const p of first.data) {
      if (targetSet.has(p.reference.trim().toUpperCase())) found.push(p);
    }

    for (let p = 2; p <= totalPages; p++) {
      if (found.length >= targetSet.size) break;
      const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE, brandId);
      if (pageData.data.length === 0) break;
      for (const prod of pageData.data) {
        if (targetSet.has(prod.reference.trim().toUpperCase())) found.push(prod);
      }
    }

    products = found;
  } else {
    // Browse mode: load all pages and filter out existing products
    const allLoaded: PfsProduct[] = [];
    const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE, brandId);
    allLoaded.push(...first.data);
    const totalPages = first.meta?.last_page ?? 1;

    products = await filterImportable(allLoaded);

    for (let p = 2; p <= totalPages; p++) {
      if (maxImportable && products.length >= maxImportable) break;
      const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE, brandId);
      if (pageData.data.length === 0) break;
      allLoaded.push(...pageData.data);
      products = await filterImportable(allLoaded);
    }

    if (maxImportable && products.length > maxImportable) {
      products = products.slice(0, maxImportable);
    }
  }

  // Référentiel PFS officiel des catégories : `listProducts` ne renvoie pas
  // toujours les labels ni le genre, alors que `/catalog/attributes/categories`
  // est la source qui fait autorité. On récupère la liste complète une seule
  // fois et on l'indexe par id. Si l'appel échoue, on retombe en mode best-effort.
  let pfsCategoriesList: PfsAttributeCategory[] = [];
  try {
    pfsCategoriesList = await pfsGetCategories();
  } catch (err) {
    logger.warn("[PFS Import] pfsGetCategories failed, using product-only data", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const categoryById = new Map<string, PfsAttributeCategory>();
  for (const c of pfsCategoriesList) categoryById.set(c.id, c);

  // Toutes les familles connues de la taxonomie locale (set plat, pour vérif rapide)
  const knownFamilyNames = new Set<string>();
  for (const fams of Object.values(PFS_FAMILIES_BY_GENDER)) {
    for (const f of fams) knownFamilyNames.add(f);
  }

  // Référentiel familles PFS : résout les IDs famille (prod.family) vers un
  // nom compatible avec la taxonomie locale. Étapes de résolution :
  //   1) Si l'ID brut est déjà dans la taxonomie → garder tel quel
  //   2) Sinon chercher dans le référentiel API : label FR, puis ID → match taxonomie
  //   3) Fallback : l'ID brut (sera affiché tel quel)
  const familyIdToName = new Map<string, string>();
  try {
    const pfsFamiliesList = await pfsGetFamilies();
    for (const f of pfsFamiliesList) {
      // Si l'ID API est déjà un nom connu de la taxonomie, rien à faire
      if (knownFamilyNames.has(f.id)) continue;
      // Sinon essayer de trouver une correspondance via le label
      const label = pickBestLabel(f.labels);
      if (!label) continue;
      // Le label peut contenir des espaces ("Bijoux Fantaisie") alors que
      // la taxonomie utilise des underscores ("Bijoux_Fantaisie").
      const underscored = label.replace(/\s+/g, "_");
      if (knownFamilyNames.has(underscored)) {
        familyIdToName.set(f.id, underscored);
      } else if (knownFamilyNames.has(label)) {
        familyIdToName.set(f.id, label);
      } else {
        // Aucune correspondance dans la taxonomie — stocker le label lisible
        familyIdToName.set(f.id, label);
      }
    }
  } catch (err) {
    logger.warn("[PFS Import] pfsGetFamilies failed, falling back to raw family IDs", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Collecte des attributs "peu coûteux" (visibles dans listProducts)
  const rawCategories: {
    pfsRef: string;
    label: string;
    enLabel: string | null;
    pfsGender: string | null;
    pfsFamilyName: string | null;
    pfsCategoryName: string | null;
  }[] = [];
  const rawColors: { pfsRef: string; label: string; enLabel: string | null; hex: string | null }[] = [];
  const rawSizes: { pfsRef: string; label: string }[] = [];

  for (const prod of products) {
    // catégorie = category.id PFS (le type précis : Bagues, Boucles d'oreilles, etc.)
    // et non family (le groupe large : Bijoux_Fantaisie) qui est identique pour tout
    if (prod.category?.id) {
      const refCategory = categoryById.get(prod.category.id);
      // Libellé : on privilégie le référentiel officiel (plus complet) puis
      // retombe sur labels embarqués sur le produit. JAMAIS sur l'ID ni sur
      // `prod.family` — sinon la modale affiche un code au lieu d'un vrai nom.
      const catLabel = pickBestLabel(refCategory?.labels) ?? pickBestLabel(prod.category.labels);
      const catEnLabel = pickEnLabel(refCategory?.labels) ?? pickEnLabel(prod.category.labels);
      const rawFamily = prod.family?.trim() || null;
      // Résolution famille en cascade :
      //   1) Référentiel PFS (label propre, ex: "Bijoux_Fantaisie")
      //   2) Recherche inverse via la sous-catégorie (ex: "Bagues" → "Bijoux_Fantaisie")
      //   3) ID brut SEULEMENT s'il correspond déjà à un nom de la taxonomie
      // On refuse expressément d'écrire un ID Salesforce (ex: a035J00000185J7QAI)
      // dans le champ `pfsFamilyName` — il s'afficherait tel quel dans l'UI et
      // en BDD, et ne ferait jamais partie de la taxonomie côté export.
      const familyName =
        (rawFamily ? familyIdToName.get(rawFamily) ?? null : null) ??
        inferPfsFamilyFromCategoryLabel(catLabel) ??
        sanitizePfsFamilyName(rawFamily);
      // Genre : 1) référentiel PFS (le plus fiable), 2) gender du produit,
      // 3) inférence via la famille (essaie le nom résolu ET l'ID brut).
      const pfsGender =
        normalizePfsGenderCode(refCategory?.gender) ??
        normalizePfsGenderCode(prod.gender) ??
        inferPfsGenderFromFamily(familyName) ??
        inferPfsGenderFromFamily(rawFamily);
      rawCategories.push({
        pfsRef: prod.category.id,
        label: catLabel ?? familyName ?? prod.category.id,
        enLabel: catEnLabel,
        pfsGender,
        pfsFamilyName: familyName,
        pfsCategoryName: catLabel,
      });
    } else if (prod.family) {
      const rawFamily = prod.family.trim();
      const familyName =
        familyIdToName.get(rawFamily) ?? sanitizePfsFamilyName(rawFamily);
      rawCategories.push({
        pfsRef: prod.family,
        label: familyName ?? rawFamily,
        enLabel: null,
        pfsGender:
          normalizePfsGenderCode(prod.gender) ??
          inferPfsGenderFromFamily(familyName) ??
          inferPfsGenderFromFamily(rawFamily),
        pfsFamilyName: familyName,
        pfsCategoryName: null,
      });
    }
    // tailles listées sur le produit
    for (const s of splitSizesString(prod.sizes)) {
      rawSizes.push({ pfsRef: s, label: s });
    }
    // couleurs depuis les variantes (chaque variante ITEM a une couleur, PACK plusieurs)
    for (const variant of prod.variants ?? []) {
      const colors: PfsColorInfo[] = variant.item
        ? [variant.item.color]
        : (variant.packs ?? []).map((pk) => pk.color);
      for (const col of colors) {
        if (col?.reference) {
          const frLabel = col.labels?.fr ?? col.labels?.en ?? col.reference;
          const enLabel = pickEnLabel(col.labels);
          const hex = typeof col.value === "string" && col.value.trim() ? col.value.trim() : null;
          rawColors.push({ pfsRef: col.reference, label: frLabel, enLabel, hex });
        }
      }
      // tailles visibles dans les variantes
      if (variant.item?.size) {
        rawSizes.push({ pfsRef: variant.item.size, label: variant.item.size });
      }
      for (const pk of variant.packs ?? []) {
        for (const sz of pk.sizes ?? []) {
          rawSizes.push({ pfsRef: sz.size, label: sz.size });
        }
      }
    }
  }

  // Scan profond (checkReference) pour compositions / pays / saisons — par lots de 5
  const rawCompositions: { pfsRef: string; label: string; enLabel: string | null }[] = [];
  const rawCountries: { pfsRef: string; label: string; enLabel: string | null; isoCode: string | null }[] = [];
  const rawSeasons: { pfsRef: string; label: string; enLabel: string | null }[] = [];

  const DEEP_SCAN_BATCH = 5;
  const sample = products.slice(0, deepSampleSize);
  for (let i = 0; i < sample.length; i += DEEP_SCAN_BATCH) {
    const batch = sample.slice(i, i + DEEP_SCAN_BATCH);
    const results = await Promise.allSettled(
      batch.map((prod) => pfsCheckReference(prod.reference)),
    );
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "rejected") {
        logger.warn("[PFS Import] scanAttributes checkReference failed", {
          ref: batch[j].reference, err: result.reason?.message ?? String(result.reason),
        });
        continue;
      }
      const detail = result.value.product;
      if (!detail) continue;

      for (const mat of detail.material_composition ?? []) {
        const label = mat.labels?.fr ?? mat.labels?.en ?? mat.reference;
        const enLabel = pickEnLabel(mat.labels);
        // On stocke le libellé FR comme `pfsRef` : c'est lui qui sert
        // d'identifiant côté CustomSelect du mapping et côté matching
        // produit→composition (la référence brute renvoyée par PFS — souvent
        // un code interne — n'est pas affichée dans l'UI).
        rawCompositions.push({ pfsRef: label, label, enLabel });
      }

      if (detail.country_of_manufacture) {
        // Idem pour les pays : on stocke le libellé FR (ex: "Chine") plutôt
        // que le code ISO ("CN"), pour rester cohérent avec ce que voit
        // l'admin dans le menu déroulant. Le code ISO ("CN") est conservé
        // à part dans `isoCode` pour pouvoir être enregistré à la création.
        const isoCode = detail.country_of_manufacture.trim().toUpperCase() || null;
        const ctryLabel = countryLabel(detail.country_of_manufacture);
        const ctryEnLabel = countryLabelEn(detail.country_of_manufacture);
        rawCountries.push({
          pfsRef: ctryLabel,
          label: ctryLabel,
          enLabel: ctryEnLabel,
          isoCode,
        });
      }

      if (detail.collection?.reference) {
        const seasonLabel = detail.collection.labels?.fr ?? detail.collection.labels?.en ?? detail.collection.reference;
        const seasonEnLabel = pickEnLabel(detail.collection.labels);
        rawSeasons.push({ pfsRef: detail.collection.reference, label: seasonLabel, enLabel: seasonEnLabel });
      }
    }
  }

  // Dédoublonnage catégorie. PFS expose parfois deux catégories différentes
  // avec le MÊME libellé mais deux IDs (ancien obsolète + nouveau actif).
  // Stratégie : si plusieurs entrées partagent le même libellé, on privilégie
  // celle dont l'ID est encore présent dans `pfsGetCategories()` (le
  // référentiel officiel = source qui fait autorité). Si aucune n'y figure
  // ou si toutes y figurent, on garde la 1ère rencontrée.
  const dedupedCategoriesByLabel = new Map<string, typeof rawCategories[number]>();
  const droppedStaleCategoryIds: string[] = [];
  for (const c of rawCategories) {
    const key = (c.label ?? c.pfsRef).trim().toLowerCase();
    const existing = dedupedCategoriesByLabel.get(key);
    if (!existing) {
      dedupedCategoriesByLabel.set(key, c);
      continue;
    }
    if (existing.pfsRef === c.pfsRef) continue; // même ID, déjà connu
    const existingIsOfficial = categoryById.has(existing.pfsRef);
    const candidateIsOfficial = categoryById.has(c.pfsRef);
    if (candidateIsOfficial && !existingIsOfficial) {
      droppedStaleCategoryIds.push(existing.pfsRef);
      dedupedCategoriesByLabel.set(key, c);
    } else {
      droppedStaleCategoryIds.push(c.pfsRef);
    }
  }
  if (droppedStaleCategoryIds.length > 0) {
    logger.info("[PFS Import] Catégories doublons écartées (ID absent du référentiel)", {
      droppedCount: droppedStaleCategoryIds.length,
      sampleIds: droppedStaleCategoryIds.slice(0, 10),
    });
  }
  const categories = uniqueMap(Array.from(dedupedCategoriesByLabel.values()), (x) => x.pfsRef);
  const colors = uniqueMap(rawColors, (x) => x.pfsRef);
  const sizes = uniqueMap(rawSizes, (x) => x.pfsRef);
  const compositions = uniqueMap(rawCompositions, (x) => x.pfsRef);
  const countries = uniqueMap(rawCountries, (x) => x.pfsRef);
  const seasons = uniqueMap(rawSeasons, (x) => x.pfsRef);

  // Vérification du mapping dans notre DB.
  // Pour les attributs autres que catégorie, on accepte un match soit par
  // référence PFS (champ `pfs*Ref`) soit par nom (déjà présent dans la
  // bibliothèque même si la référence PFS n'avait jamais été enregistrée).
  // Ça évite que le scan propose de re-créer une couleur/taille/etc. qui
  // existe déjà chez nous sous un nom équivalent.
  const colorRefs = colors.map((c) => c.pfsRef);
  const colorLabels = colors.map((c) => c.label);
  const sizeRefs = sizes.map((s) => s.pfsRef);
  const sizeLabels = sizes.map((s) => s.label);
  const compRefs = compositions.map((c) => c.pfsRef);
  const compLabels = compositions.map((c) => c.label);
  const countryRefs = countries.map((c) => c.pfsRef);
  const countryLabels = countries.map((c) => c.label);
  const seasonRefs = seasons.map((s) => s.pfsRef);
  const seasonLabels = seasons.map((s) => s.label);

  const [localCategories, localColors, localSizes, localCompositions, localCountries, localSeasons] = await Promise.all([
    prisma.category.findMany({
      where: { pfsCategoryId: { in: categories.map((c) => c.pfsRef) } },
      select: { id: true, name: true, pfsCategoryId: true },
    }),
    prisma.color.findMany({
      where: {
        OR: [
          { pfsColorRef: { in: colorRefs } },
          { name: { in: colorLabels } },
        ],
      },
      select: { id: true, name: true, pfsColorRef: true },
    }),
    prisma.size.findMany({
      where: {
        OR: [
          { pfsSizeRef: { in: sizeRefs } },
          { name: { in: sizeLabels } },
          // Cas spécial : si PFS envoie "TU" et qu'on a déjà la taille
          // protégée « Taille unique » sans pfsSizeRef renseigné, on veut
          // quand même la trouver pour la rattacher au lieu de proposer
          // une nouvelle création.
          ...(sizeRefs.includes(PROTECTED_SIZE_PFS_REF)
            ? [{ name: PROTECTED_SIZE_NAME }]
            : []),
        ],
      },
      select: { id: true, name: true, pfsSizeRef: true },
    }),
    prisma.composition.findMany({
      where: {
        OR: [
          { pfsCompositionRef: { in: compRefs } },
          { name: { in: compLabels } },
        ],
      },
      select: { id: true, name: true, pfsCompositionRef: true },
    }),
    prisma.manufacturingCountry.findMany({
      where: {
        OR: [
          { pfsCountryRef: { in: countryRefs } },
          { name: { in: countryLabels } },
        ],
      },
      select: { id: true, name: true, pfsCountryRef: true },
    }),
    prisma.season.findMany({
      where: {
        OR: [
          { pfsRef: { in: seasonRefs } },
          { name: { in: seasonLabels } },
        ],
      },
      select: { id: true, name: true, pfsRef: true },
    }),
  ]);

  // Helper : normalisation pour comparer des libellés "à l'œil" (insensible à
  // la casse / aux espaces de bordure). Les bibliothèques côté admin sont
  // saisies en français — un libellé PFS « Doré » et un local « doré »
  // doivent matcher.
  const normalize = (s: string | null | undefined) =>
    (s ?? "").trim().toLocaleLowerCase("fr-FR");

  /**
   * Construit deux index : par référence PFS et par nom normalisé.
   * Permet ensuite de matcher un attribut PFS sur l'un ou l'autre.
   */
  function buildAttrIndex<T extends { id: string; name: string }>(
    items: T[],
    getRef: (item: T) => string | null | undefined,
  ): { byRef: Map<string, T>; byName: Map<string, T> } {
    const byRef = new Map<string, T>();
    const byName = new Map<string, T>();
    for (const item of items) {
      const ref = getRef(item);
      if (ref) byRef.set(ref, item);
      const nameKey = normalize(item.name);
      if (nameKey && !byName.has(nameKey)) byName.set(nameKey, item);
    }
    return { byRef, byName };
  }

  const catIndex = new Map(localCategories.map((c) => [c.pfsCategoryId!, c]));
  const colIndex = buildAttrIndex(localColors, (c) => c.pfsColorRef);
  const szIndex = buildAttrIndex(localSizes, (s) => s.pfsSizeRef);
  const cpIndex = buildAttrIndex(localCompositions, (c) => c.pfsCompositionRef);
  const ctryIndex = buildAttrIndex(localCountries, (c) => c.pfsCountryRef);
  const seaIndex = buildAttrIndex(localSeasons, (s) => s.pfsRef);

  // Cas spécial taille TU : on indexe la taille protégée « Taille unique »
  // sous la référence "TU" et le nom "tu" pour que findLocal la retrouve même
  // quand elle a été créée à la main avant que `pfsSizeRef` n'existe.
  const protectedSize = localSizes.find((s) => isProtectedSizeName(s.name));
  if (protectedSize) {
    if (!szIndex.byRef.has(PROTECTED_SIZE_PFS_REF)) {
      szIndex.byRef.set(PROTECTED_SIZE_PFS_REF, protectedSize);
    }
    const tuKey = normalize(PROTECTED_SIZE_PFS_REF);
    if (!szIndex.byName.has(tuKey)) {
      szIndex.byName.set(tuKey, protectedSize);
    }
  }

  const findLocal = <T extends { id: string; name: string }>(
    index: { byRef: Map<string, T>; byName: Map<string, T> },
    pfsRef: string,
    label: string,
  ): T | undefined => index.byRef.get(pfsRef) ?? index.byName.get(normalize(label));

  const out: PfsAttribute[] = [];

  for (const c of categories) {
    const local = catIndex.get(c.pfsRef);
    out.push({
      type: "category",
      pfsRef: c.pfsRef,
      label: c.label,
      enLabel: c.enLabel,
      mapped: !!local,
      localId: local?.id,
      localName: local?.name,
      meta: {
        pfsGender: c.pfsGender,
        pfsFamilyName: c.pfsFamilyName,
        pfsCategoryName: c.pfsCategoryName,
      },
    });
  }
  for (const c of colors) {
    const local = findLocal(colIndex, c.pfsRef, c.label);
    out.push({
      type: "color",
      pfsRef: c.pfsRef,
      label: c.label,
      enLabel: c.enLabel,
      mapped: !!local,
      localId: local?.id,
      localName: local?.name,
      meta: { hex: c.hex },
    });
  }
  for (const s of sizes) {
    const local = findLocal(szIndex, s.pfsRef, s.label);
    // Pour la taille TU on affiche le nom canonique « Taille unique » côté
    // admin : c'est plus parlant et c'est exactement comme ça qu'elle sera
    // créée si on déclenche la création.
    const displayLabel =
      s.pfsRef.trim().toUpperCase() === PROTECTED_SIZE_PFS_REF
        ? PROTECTED_SIZE_NAME
        : s.label;
    out.push({
      type: "size",
      pfsRef: s.pfsRef,
      label: displayLabel,
      mapped: !!local,
      localId: local?.id,
      localName: local?.name,
    });
  }
  for (const c of compositions) {
    const local = findLocal(cpIndex, c.pfsRef, c.label);
    out.push({ type: "composition", pfsRef: c.pfsRef, label: c.label, enLabel: c.enLabel, mapped: !!local, localId: local?.id, localName: local?.name });
  }
  for (const c of countries) {
    const local = findLocal(ctryIndex, c.pfsRef, c.label);
    out.push({
      type: "country",
      pfsRef: c.pfsRef,
      label: c.label,
      enLabel: c.enLabel,
      mapped: !!local,
      localId: local?.id,
      localName: local?.name,
      meta: { isoCode: c.isoCode },
    });
  }
  for (const s of seasons) {
    const local = findLocal(seaIndex, s.pfsRef, s.label);
    out.push({ type: "season", pfsRef: s.pfsRef, label: s.label, enLabel: s.enLabel, mapped: !!local, localId: local?.id, localName: local?.name });
  }

  return {
    attributes: out,
    scannedProducts: products.length,
    deepScannedProducts: sample.length,
  };
}

// ─────────────────────────────────────────────
// 2 — Créer / lier une correspondance manquante
// ─────────────────────────────────────────────

export interface CreateMappingInput {
  type: PfsAttributeType;
  pfsRef: string;
  label: string;
  /** Libellé EN venant directement de PFS — sauvé comme traduction et évite
   *  l'appel DeepL. Ignoré pour le type "size" (pas de traduction). */
  enLabel?: string | null;
  // Lier à une entité existante au lieu de créer (facultatif)
  linkToExistingId?: string;
  // Métadonnées catégorie (genre / famille / sous-catégorie PFS)
  pfsGender?: string | null;
  pfsFamilyName?: string | null;
  pfsCategoryName?: string | null;
  // Code hex PFS (#RRGGBB) — appliqué uniquement pour le type "color"
  hex?: string | null;
  /** Code ISO pays (ex: "CN") — appliqué uniquement pour le type "country" */
  isoCode?: string | null;
}

/** Normalise un code hex PFS en #RRGGBB (ou null si invalide). */
function normalizePfsHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toLowerCase() : null;
}

export interface CreateMappingResult {
  id: string;
  name: string;
  created: boolean; // true = entité créée, false = entité existante liée
}

export async function createOrLinkMapping(input: CreateMappingInput): Promise<CreateMappingResult> {
  const { type, pfsRef, label, linkToExistingId, pfsGender, pfsFamilyName, pfsCategoryName, hex } = input;
  // Libellé EN PFS : utilisé pour préremplir la traduction sans appeler DeepL.
  // Même quand l'EN est identique au FR (ex: "Bracelets"), on stocke et on
  // skippe DeepL : PFS confirme explicitement que la version anglaise c'est ça.
  const trimmedEn = input.enLabel?.trim() || null;
  const enLabel = trimmedEn;

  switch (type) {
    case "category": {
      // Filtre de sécurité : on n'accepte que des familles connues de la
      // taxonomie locale. Empêche un identifiant Salesforce brut, glissé
      // depuis le scan, de finir enregistré dans `Category.pfsFamilyName`.
      const safeFamilyName = sanitizePfsFamilyName(pfsFamilyName);
      const catData = {
        pfsCategoryId: pfsRef,
        pfsCategoryName: pfsCategoryName?.trim() || label,
        ...(pfsGender ? { pfsGender: pfsGender.trim() } : {}),
        ...(safeFamilyName ? { pfsFamilyName: safeFamilyName } : {}),
      };
      if (linkToExistingId) {
        const upd = await prisma.category.update({
          where: { id: linkToExistingId },
          data: catData,
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      // D'abord chercher par pfsCategoryId (match exact PFS) pour ne pas
      // écraser une catégorie différente qui a le même nom
      const existingByPfsId = await prisma.category.findFirst({
        where: { pfsCategoryId: pfsRef },
      });
      if (existingByPfsId) {
        await prisma.category.update({
          where: { id: existingByPfsId.id },
          data: catData,
        });
        return { id: existingByPfsId.id, name: existingByPfsId.name, created: false };
      }
      // Sinon chercher par nom. Si une catégorie locale du même nom existe
      // déjà mais avec un AUTRE pfsCategoryId (= PFS expose un doublon avec
      // ID ancien obsolète + ID nouveau actif), on alias silencieusement :
      // on garde le mapping existant intact et on renvoie OK pour ne pas
      // bloquer le bulk-create. Cas couverts :
      //   1) cat sans pfsCategoryId → on remplit
      //   2) cat avec même pfsRef    → on met à jour les méta
      //   3) cat avec autre pfsRef   → alias, on ne touche à rien
      const existingByName = await prisma.category.findFirst({
        where: { name: label },
      });
      if (existingByName) {
        const sameOrEmpty =
          !existingByName.pfsCategoryId ||
          existingByName.pfsCategoryId === "" ||
          existingByName.pfsCategoryId === pfsRef;
        if (sameOrEmpty) {
          await prisma.category.update({
            where: { id: existingByName.id },
            data: catData,
          });
        } else {
          logger.warn("[PFS Import] Doublon PFS catégorie — alias silencieux", {
            categoryId: existingByName.id,
            categoryName: existingByName.name,
            keptPfsCategoryId: existingByName.pfsCategoryId,
            ignoredPfsCategoryId: pfsRef,
          });
        }
        return { id: existingByName.id, name: existingByName.name, created: false };
      }
      const slug = label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const created = await prisma.category.create({
        data: { name: label, slug, ...catData },
        select: { id: true, name: true },
      });
      if (enLabel) {
        await prisma.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId: created.id, locale: "en" } },
          update: { name: enLabel },
          create: { categoryId: created.id, locale: "en", name: enLabel },
        });
      } else {
        autoTranslateCategory(created.id, created.name);
      }
      return { id: created.id, name: created.name, created: true };
    }

    case "color": {
      const normalizedHex = normalizePfsHex(hex);
      const trimmedRef = pfsRef.trim() || null;
      if (linkToExistingId) {
        const existing = await prisma.color.findUnique({
          where: { id: linkToExistingId },
          select: { hex: true, pfsColorRef: true },
        });
        const data: { hex?: string; pfsColorRef?: string } = {};
        if (normalizedHex && !existing?.hex) data.hex = normalizedHex;
        if (trimmedRef && !existing?.pfsColorRef) data.pfsColorRef = trimmedRef;
        const upd = await prisma.color.update({
          where: { id: linkToExistingId },
          data,
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      // Doublon PFS : si une couleur du même nom existe déjà localement, on
      // alias plutôt que de planter sur la contrainte unique de Color.name.
      const existingByName = await prisma.color.findFirst({
        where: { name: label },
        select: { id: true, name: true, hex: true, pfsColorRef: true },
      });
      if (existingByName) {
        const data: { hex?: string; pfsColorRef?: string } = {};
        if (normalizedHex && !existingByName.hex) data.hex = normalizedHex;
        if (trimmedRef && !existingByName.pfsColorRef) data.pfsColorRef = trimmedRef;
        if (Object.keys(data).length > 0) {
          await prisma.color.update({ where: { id: existingByName.id }, data });
        } else if (
          existingByName.pfsColorRef &&
          trimmedRef &&
          existingByName.pfsColorRef !== trimmedRef
        ) {
          logger.warn("[PFS Import] Doublon PFS couleur — alias silencieux", {
            colorId: existingByName.id,
            colorName: existingByName.name,
            keptPfsColorRef: existingByName.pfsColorRef,
            ignoredPfsColorRef: trimmedRef,
          });
        }
        return { id: existingByName.id, name: existingByName.name, created: false };
      }
      const created = await prisma.color.create({
        data: { name: label, hex: normalizedHex, pfsColorRef: trimmedRef },
        select: { id: true, name: true },
      });
      if (enLabel) {
        await prisma.colorTranslation.upsert({
          where: { colorId_locale: { colorId: created.id, locale: "en" } },
          update: { name: enLabel },
          create: { colorId: created.id, locale: "en", name: enLabel },
        });
      } else {
        autoTranslateColor(created.id, created.name);
      }
      return { id: created.id, name: created.name, created: true };
    }

    case "size": {
      if (linkToExistingId) {
        const upd = await prisma.size.update({
          where: { id: linkToExistingId },
          data: { pfsSizeRef: pfsRef },
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      // Garde-fou : si PFS demande "TU", on a deux scénarios :
      //   1) Notre taille protégée « Taille unique » existe déjà → on rattache
      //      (et on complète son pfsSizeRef si manquant).
      //   2) Elle n'existe pas → on la CRÉE avec le bon nom canonique
      //      « Taille unique » + pfsSizeRef « TU », au lieu de créer une
      //      ligne « TU » qui ferait doublon plus tard.
      if (pfsRef.trim().toUpperCase() === PROTECTED_SIZE_PFS_REF) {
        const protectedRow = await prisma.size.findFirst({
          where: { name: PROTECTED_SIZE_NAME },
          select: { id: true, name: true, pfsSizeRef: true },
        });
        if (protectedRow) {
          if (!protectedRow.pfsSizeRef) {
            await prisma.size.update({
              where: { id: protectedRow.id },
              data: { pfsSizeRef: PROTECTED_SIZE_PFS_REF },
            });
          }
          return { id: protectedRow.id, name: protectedRow.name, created: false };
        }
        // « Taille unique » n'existe pas → on la crée avec le bon nom
        const createdProtected = await prisma.size.create({
          data: {
            name: PROTECTED_SIZE_NAME,
            pfsSizeRef: PROTECTED_SIZE_PFS_REF,
            position: 0,
          },
          select: { id: true, name: true },
        });
        return { id: createdProtected.id, name: createdProtected.name, created: true };
      }
      // Doublon PFS : si une taille du même nom existe déjà, on alias.
      const existingSizeByName = await prisma.size.findFirst({
        where: { name: label },
        select: { id: true, name: true, pfsSizeRef: true },
      });
      if (existingSizeByName) {
        if (!existingSizeByName.pfsSizeRef) {
          await prisma.size.update({
            where: { id: existingSizeByName.id },
            data: { pfsSizeRef: pfsRef },
          });
        } else if (existingSizeByName.pfsSizeRef !== pfsRef) {
          logger.warn("[PFS Import] Doublon PFS taille — alias silencieux", {
            sizeId: existingSizeByName.id,
            sizeName: existingSizeByName.name,
            keptPfsSizeRef: existingSizeByName.pfsSizeRef,
            ignoredPfsSizeRef: pfsRef,
          });
        }
        return { id: existingSizeByName.id, name: existingSizeByName.name, created: false };
      }
      const created = await prisma.size.create({
        data: { name: label, pfsSizeRef: pfsRef },
        select: { id: true, name: true },
      });
      return { id: created.id, name: created.name, created: true };
    }

    case "composition": {
      if (linkToExistingId) {
        const upd = await prisma.composition.update({
          where: { id: linkToExistingId },
          data: { pfsCompositionRef: pfsRef },
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      // Doublon PFS : si une composition du même nom existe déjà, on alias.
      const existingCompoByName = await prisma.composition.findFirst({
        where: { name: label },
        select: { id: true, name: true, pfsCompositionRef: true },
      });
      if (existingCompoByName) {
        if (!existingCompoByName.pfsCompositionRef) {
          await prisma.composition.update({
            where: { id: existingCompoByName.id },
            data: { pfsCompositionRef: pfsRef },
          });
        } else if (existingCompoByName.pfsCompositionRef !== pfsRef) {
          logger.warn("[PFS Import] Doublon PFS composition — alias silencieux", {
            compositionId: existingCompoByName.id,
            compositionName: existingCompoByName.name,
            keptPfsCompositionRef: existingCompoByName.pfsCompositionRef,
            ignoredPfsCompositionRef: pfsRef,
          });
        }
        return { id: existingCompoByName.id, name: existingCompoByName.name, created: false };
      }
      const created = await prisma.composition.create({
        data: { name: label, pfsCompositionRef: pfsRef },
        select: { id: true, name: true },
      });
      if (enLabel) {
        await prisma.compositionTranslation.upsert({
          where: { compositionId_locale: { compositionId: created.id, locale: "en" } },
          update: { name: enLabel },
          create: { compositionId: created.id, locale: "en", name: enLabel },
        });
      } else {
        autoTranslateComposition(created.id, created.name);
      }
      return { id: created.id, name: created.name, created: true };
    }

    case "country": {
      // Validation simple : code ISO sur 2 lettres (ex: "CN", "FR"). null sinon.
      const cleanIso = (input.isoCode ?? "").trim().toUpperCase();
      const isoCode = /^[A-Z]{2}$/.test(cleanIso) ? cleanIso : null;

      if (linkToExistingId) {
        // Si l'entité existe déjà mais sans isoCode, on profite du nouvel
        // import pour le compléter (sans jamais écraser un code déjà présent).
        const existing = await prisma.manufacturingCountry.findUnique({
          where: { id: linkToExistingId },
          select: { isoCode: true },
        });
        const data: { pfsCountryRef: string; isoCode?: string } = { pfsCountryRef: pfsRef };
        if (isoCode && !existing?.isoCode) data.isoCode = isoCode;
        const upd = await prisma.manufacturingCountry.update({
          where: { id: linkToExistingId },
          data,
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      // Doublon PFS : si un pays du même nom existe déjà, on alias plutôt
      // que de planter sur la contrainte unique de ManufacturingCountry.name
      // (ou de pfsCountryRef/isoCode).
      const existingCountryByName = await prisma.manufacturingCountry.findFirst({
        where: { name: label },
        select: { id: true, name: true, pfsCountryRef: true, isoCode: true },
      });
      if (existingCountryByName) {
        const data: { pfsCountryRef?: string; isoCode?: string } = {};
        if (!existingCountryByName.pfsCountryRef) data.pfsCountryRef = pfsRef;
        if (isoCode && !existingCountryByName.isoCode) data.isoCode = isoCode;
        if (Object.keys(data).length > 0) {
          await prisma.manufacturingCountry.update({
            where: { id: existingCountryByName.id },
            data,
          });
        } else if (
          existingCountryByName.pfsCountryRef &&
          existingCountryByName.pfsCountryRef !== pfsRef
        ) {
          logger.warn("[PFS Import] Doublon PFS pays — alias silencieux", {
            countryId: existingCountryByName.id,
            countryName: existingCountryByName.name,
            keptPfsCountryRef: existingCountryByName.pfsCountryRef,
            ignoredPfsCountryRef: pfsRef,
          });
        }
        return { id: existingCountryByName.id, name: existingCountryByName.name, created: false };
      }
      // `pfsRef` est le libellé FR du pays (ex: "Chine"), pas le code ISO.
      // Le code ISO ("CN") est passé séparément via `input.isoCode` et
      // enregistré directement, évitant à l'admin de le saisir à la main.
      const created = await prisma.manufacturingCountry.create({
        data: { name: label, pfsCountryRef: pfsRef, isoCode },
        select: { id: true, name: true },
      });
      if (enLabel) {
        await prisma.manufacturingCountryTranslation.upsert({
          where: { manufacturingCountryId_locale: { manufacturingCountryId: created.id, locale: "en" } },
          update: { name: enLabel },
          create: { manufacturingCountryId: created.id, locale: "en", name: enLabel },
        });
      } else {
        autoTranslateManufacturingCountry(created.id, created.name);
      }
      return { id: created.id, name: created.name, created: true };
    }

    case "season": {
      if (linkToExistingId) {
        const upd = await prisma.season.update({
          where: { id: linkToExistingId },
          data: { pfsRef },
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      // Doublon PFS : si une saison du même nom existe déjà, on alias.
      const existingSeasonByName = await prisma.season.findFirst({
        where: { name: label },
        select: { id: true, name: true, pfsRef: true },
      });
      if (existingSeasonByName) {
        if (!existingSeasonByName.pfsRef) {
          await prisma.season.update({
            where: { id: existingSeasonByName.id },
            data: { pfsRef },
          });
        } else if (existingSeasonByName.pfsRef !== pfsRef) {
          logger.warn("[PFS Import] Doublon PFS saison — alias silencieux", {
            seasonId: existingSeasonByName.id,
            seasonName: existingSeasonByName.name,
            keptPfsRef: existingSeasonByName.pfsRef,
            ignoredPfsRef: pfsRef,
          });
        }
        return { id: existingSeasonByName.id, name: existingSeasonByName.name, created: false };
      }
      const created = await prisma.season.create({
        data: { name: label, pfsRef },
        select: { id: true, name: true },
      });
      if (enLabel) {
        await prisma.seasonTranslation.upsert({
          where: { seasonId_locale: { seasonId: created.id, locale: "en" } },
          update: { name: enLabel },
          create: { seasonId: created.id, locale: "en", name: enLabel },
        });
      } else {
        autoTranslateSeason(created.id, created.name);
      }
      return { id: created.id, name: created.name, created: true };
    }

    default:
      throw new Error(`Type d'attribut inconnu : ${type}`);
  }
}

// ─────────────────────────────────────────────
// 3 — Lister les produits PFS à importer (hors produits déjà chez nous)
// ─────────────────────────────────────────────

export async function listImportablePfsProducts(options?: { maxProducts?: number }): Promise<ImportablePfsProduct[]> {
  const maxProducts = options?.maxProducts;

  // Marque PFS obligatoire — uniquement les produits de la marque sélectionnée.
  const pfsBrand = await requirePfsBrand();
  const brandId = pfsBrand.id;

  // Charge page par page, filtre ceux déjà chez nous, s'arrête quand on a le compte
  const importable: PfsProduct[] = [];
  const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE, brandId);
  const totalPages = first.meta?.last_page ?? 1;

  // Filtre la première page
  const firstFiltered = await filterImportable(first.data);
  importable.push(...firstFiltered);

  // Continue page par page jusqu'à avoir assez
  for (let p = 2; p <= totalPages; p++) {
    if (maxProducts && importable.length >= maxProducts) break;
    const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE, brandId);
    if (pageData.data.length === 0) break;
    const filtered = await filterImportable(pageData.data);
    importable.push(...filtered);
  }

  // Limite au nombre demandé
  const result = maxProducts ? importable.slice(0, maxProducts) : importable;

  // Résolution famille ID → nom pour l'affichage dans la grille de sélection
  const famMap = new Map<string, string>();
  try {
    const fams = await pfsGetFamilies();
    for (const f of fams) {
      const label = pickBestLabel(f.labels);
      if (label) famMap.set(f.id, label);
    }
  } catch { /* ignoré */ }

  return result.map((p) => {
    const resolvedFamily = (p.family ? famMap.get(p.family) : null) ?? p.family ?? "";
    return {
      pfsId: p.id,
      reference: p.reference,
      name: p.labels?.fr ?? p.labels?.en ?? p.reference,
      category: p.category?.labels?.fr ?? p.category?.labels?.en ?? resolvedFamily,
      family: resolvedFamily,
      colorCount: (p.colors ?? "").split(";").filter((c) => c.trim()).length,
      variantCount: p.count_variants ?? 0,
      defaultImage: pickDefaultImage(p.images),
    };
  });
}

// ─────────────────────────────────────────────
// 4 — Approbation d'un produit PFS → création en DB
// ─────────────────────────────────────────────

export interface ApprovePfsProductResult {
  productId: string;
  reference: string;
  name: string;
  warnings: string[];
}

interface ResolvedPackLine {
  colorId: string;
  sizeEntries: { sizeId: string; quantity: number }[];
}

interface ResolvedVariant {
  colorId: string;
  /** Identifiant PFS de la variante — stocké en base pour le refresh / publish ultérieur. */
  pfsVariantId: string;
  unitPrice: number;
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  /** Référence PFS de la couleur principale (toujours renseignée, sert à détecter la couleur par défaut). */
  primaryPfsColorRef: string;
  /** Labels localisés de la première couleur (normalisés). Sert au matching default_color. */
  primaryColorLabels: string[];
  /** is_star renvoyé par PFS : signal additionnel pour la couleur principale. */
  isStar: boolean;
  sizeEntries: { sizeId: string; quantity: number }[];
  /**
   * Composition d'un pack multi-couleurs : 1 entrée par couleur, chacune avec
   * ses propres tailles/quantités. Vide pour UNIT et PACK mono-couleur. Quand
   * `packLines.length > 0`, `sizeEntries` doit rester vide.
   */
  packLines: ResolvedPackLine[];
  /** Tous les colorId présents dans le variant (utilisé pour le SKU multi). */
  allColorIds: string[];
  /**
   * Images groupées par couleur locale. Pour un UNIT ou un PACK mono-couleur,
   * une seule entrée (la couleur principale). Pour un PACK multi-couleurs,
   * une entrée par couleur du pack — chaque image sera enregistrée avec son
   * propre `colorId` pour qu'elle apparaisse dans le bon onglet du modal
   * d'images (ex: les photos KAKI restent dans l'onglet Kaki, pas Brun).
   */
  imagesByColor: { colorId: string; urls: string[] }[];
  /**
   * Mapping (réf + libellés PFS → colorId local) pour TOUTES les couleurs du
   * variant (couleur principale + chaque ligne de pack pour un multi-couleurs).
   * Sert à résoudre le `default_color` PFS, même quand celui-ci pointe vers
   * une couleur qui vit uniquement dans un pack multi-couleurs.
   */
  pfsColorMappings: { reference: string; labels: string[]; localId: string }[];
}

/**
 * Compare la clé DEFAUT du map d'images à celles des couleurs : renvoie la
 * référence (normalisée) de la couleur qui partage la même URL d'image.
 * C'est le signal le plus fiable pour identifier la couleur par défaut PFS.
 */
export function findPrimaryPfsColorRefFromImages(
  images: Record<string, string | string[]> | null | undefined,
): string | null {
  if (!images) return null;
  const defaut = images["DEFAUT"] ?? images["DEFAULT"] ?? images["default"];
  const defaultFirst = firstStringImage(defaut);
  if (!defaultFirst) return null;
  for (const key of Object.keys(images)) {
    const normalized = normalizeKey(key);
    if (normalized === "DEFAUT" || normalized === "DEFAULT") continue;
    const first = firstStringImage(images[key]);
    if (first && first === defaultFirst) return normalized;
  }
  return null;
}

/**
 * Compat : renvoie d'abord `default_color` normalisé s'il est fourni,
 * sinon tente le matching d'image DEFAUT.
 */
export function findPrimaryPfsColorRef(
  defaultColor: string | null | undefined,
  images: Record<string, string | string[]> | null | undefined,
): string | null {
  if (defaultColor && defaultColor.trim()) return normalizeKey(defaultColor);
  return findPrimaryPfsColorRefFromImages(images);
}

/**
 * Détermine la référence PFS (normalisée) de la couleur principale à partir
 * de plusieurs signaux cumulés (image DEFAUT, default_color, is_star).
 * Retourne null si aucun signal ne fonctionne.
 */
function detectPrimaryColorRef(
  variants: ResolvedVariant[],
  defaultColor: string | null | undefined,
  productImages: Record<string, string | string[]> | null | undefined,
  reference: string,
  warnings: string[],
): { ref: string; via: string } | null {
  const normalizedVariantRefs = variants.map((rv) => normalizeKey(rv.primaryPfsColorRef));

  // 1) URL image DEFAUT identique à celle d'une couleur (le plus fiable)
  const imgMatch = findPrimaryPfsColorRefFromImages(productImages);
  if (imgMatch && normalizedVariantRefs.includes(imgMatch)) {
    return { ref: imgMatch, via: "DEFAUT image match" };
  }

  // 2) default_color — peut être une référence OU un label localisé
  if (defaultColor && defaultColor.trim()) {
    const normalized = normalizeKey(defaultColor);
    if (normalizedVariantRefs.includes(normalized)) {
      return { ref: normalized, via: "default_color (reference)" };
    }
    const byLabel = variants.find((rv) => rv.primaryColorLabels.includes(normalized));
    if (byLabel) {
      return { ref: normalizeKey(byLabel.primaryPfsColorRef), via: "default_color (label)" };
    }
    warnings.push(`Couleur par défaut PFS "${defaultColor}" non reconnue — autre signal utilisé`);
  }

  // 3) Variante marquée is_star par PFS
  const star = variants.find((rv) => rv.isStar);
  if (star) return { ref: normalizeKey(star.primaryPfsColorRef), via: "is_star" };

  logger.info("[PFS Import] Primary color: no signal available, falling back", {
    reference,
    defaultColor,
    variantRefs: normalizedVariantRefs,
    imagesKeys: productImages ? Object.keys(productImages) : [],
  });
  return null;
}

/**
 * Trouve le `colorId` local correspondant à la couleur principale PFS,
 * en parcourant TOUTES les couleurs du produit (couleur principale de chaque
 * variante + chaque ligne de pack multi-couleurs). Cas typique : FZEAFSDF
 * envoie `default_color = "KAKI"` alors que Kaki vit uniquement dans le pack
 * BROWN+KAKI — on le retrouve via les mappings de pack-line.
 *
 * Signaux dans l'ordre de fiabilité :
 *   1) Image DEFAUT du produit dont l'URL matche celle d'une couleur connue.
 *   2) `default_color` PFS, comparé à la fois à la référence et aux libellés.
 *   3) Variante PFS marquée `is_star` → on prend sa couleur principale.
 * Retourne null si aucun signal ne fonctionne.
 */
export function findPrimaryColorIdFromPfs(args: {
  variants: Pick<ResolvedVariant, "primaryPfsColorRef" | "isStar" | "pfsColorMappings">[];
  defaultColor: string | null | undefined;
  productImages: Record<string, string | string[]> | null | undefined;
}): string | null {
  const { variants, defaultColor, productImages } = args;
  // Index global PFS-ref/label (normalisés) → colorId local, en agrégeant
  // toutes les variantes (couleur principale + pack-lines).
  const refToLocal = new Map<string, string>();
  for (const rv of variants) {
    for (const m of rv.pfsColorMappings) {
      refToLocal.set(normalizeKey(m.reference), m.localId);
      for (const label of m.labels) {
        const k = normalizeKey(label);
        if (!refToLocal.has(k)) refToLocal.set(k, m.localId);
      }
    }
  }

  // 1) DEFAUT image match (le plus fiable)
  const imgMatch = findPrimaryPfsColorRefFromImages(productImages);
  if (imgMatch) {
    const local = refToLocal.get(imgMatch);
    if (local) return local;
  }

  // 2) default_color (peut être une référence OU un label localisé)
  if (defaultColor && defaultColor.trim()) {
    const local = refToLocal.get(normalizeKey(defaultColor));
    if (local) return local;
  }

  // 3) Variante marquée is_star : prend sa couleur principale
  const star = variants.find((rv) => rv.isStar);
  if (star) {
    const local = refToLocal.get(normalizeKey(star.primaryPfsColorRef));
    if (local) return local;
  }

  return null;
}

/**
 * Renvoie l'index de la variante à marquer comme couleur principale.
 * Préfère UNIT sur PACK à couleur égale (car l'UI admin filtre les PACK hors
 * du badge "couleur principale" — si on mettait isPrimary sur un PACK, le
 * badge afficherait une autre couleur UNIT à la place).
 * Retourne toujours un index valide (0 par défaut).
 */
function findPrimaryVariantIndex(
  variants: ResolvedVariant[],
  defaultColor: string | null | undefined,
  productImages: Record<string, string | string[]> | null | undefined,
  reference: string,
  warnings: string[],
): number {
  const detected = detectPrimaryColorRef(variants, defaultColor, productImages, reference, warnings);
  if (!detected) return 0;

  const { ref, via } = detected;
  // Préférence 1 : UNIT de la couleur principale
  const unitIdx = variants.findIndex(
    (rv) => normalizeKey(rv.primaryPfsColorRef) === ref && rv.saleType === "UNIT",
  );
  if (unitIdx >= 0) {
    logger.info("[PFS Import] Primary color via " + via, { reference, ref, index: unitIdx, saleType: "UNIT" });
    return unitIdx;
  }
  // Préférence 2 : n'importe quelle variante (PACK) de la couleur principale
  const anyIdx = variants.findIndex((rv) => normalizeKey(rv.primaryPfsColorRef) === ref);
  if (anyIdx >= 0) {
    logger.info("[PFS Import] Primary color via " + via, { reference, ref, index: anyIdx, saleType: "PACK" });
    return anyIdx;
  }
  return 0;
}

/**
 * Approuve un produit PFS : crée le Product en DB avec status SYNCING,
 * puis déclenche le téléchargement des images en arrière-plan.
 * Passe en OFFLINE une fois les images prêtes.
 *
 * Si `options.isCancelled` est fourni, l'import est interrompu dès qu'il retourne
 * true (entre chaque étape), et le produit partiel est supprimé de la DB.
 */
export async function approveAndImportPfsProduct(
  pfsId: string,
  options?: ImportCancellationOptions,
): Promise<ApprovePfsProductResult> {
  const isCancelled = options?.isCancelled;
  const warnings: string[] = [];

  // Marque PFS obligatoire (blocage clair si non sélectionnée).
  await requirePfsBrand();

  const product: PfsProduct | undefined = await getCachedPfsProductById(pfsId);
  if (!product) throw new Error(`Produit PFS introuvable : ${pfsId}`);

  const reference = product.reference.trim().toUpperCase();
  const existing = await prisma.product.findUnique({ where: { reference } });
  if (existing) throw new Error(`Produit déjà importé : ${reference}`);

  // ── Phase parallèle 1 : appels PFS qui ne dépendent que du `product`
  const [refData, variantResponseResult, families] = await Promise.all([
    pfsCheckReference(product.reference),
    pfsGetVariants(product.id)
      .then((r) => ({ ok: true as const, data: r }))
      .catch((err: unknown) => ({ ok: false as const, err })),
    pfsGetFamilies().catch(() => [] as Awaited<ReturnType<typeof pfsGetFamilies>>),
  ]);
  const detail = refData.product;

  // Résolution catégorie
  const pfsCatId = product.category?.id;
  const rawFamily = product.family?.trim() || null;
  const familyLookupValues: string[] = [];
  if (rawFamily) familyLookupValues.push(rawFamily);
  const familyMatch = families.find((f) => f.id === rawFamily);
  const familyLabel = pickBestLabel(familyMatch?.labels);
  if (familyLabel && !familyLookupValues.includes(familyLabel)) familyLookupValues.push(familyLabel);
  const familyUnderscored = familyLabel?.replace(/\s+/g, "_");
  if (familyUnderscored && !familyLookupValues.includes(familyUnderscored)) familyLookupValues.push(familyUnderscored);

  // ── Phase parallèle 2 : résolutions Prisma read-only
  const ctryCode = detail?.country_of_manufacture ?? null;
  const ctryLabelFr = ctryCode ? countryLabel(ctryCode) : null;
  const seasonRef = detail?.collection?.reference ?? null;
  const materialEntries = (detail?.material_composition ?? []).map((mat) => ({
    label: mat.labels?.fr ?? mat.labels?.en ?? mat.reference,
    percentage: mat.percentage,
  }));

  // Filet de sécurité : si PFS renvoie un pfsCategoryId obsolète (doublon),
  // on essaie aussi de retrouver la catégorie locale par son nom (libellé FR/EN).
  const categoryLabelFr = product.category?.labels?.fr?.trim() || null;
  const categoryLabelEn = product.category?.labels?.en?.trim() || null;
  const categoryNameLookups: string[] = [];
  if (categoryLabelFr) categoryNameLookups.push(categoryLabelFr);
  if (categoryLabelEn && !categoryNameLookups.includes(categoryLabelEn)) categoryNameLookups.push(categoryLabelEn);

  const [
    primaryCategory,
    fallbackCategory,
    nameFallbackCategory,
    countryRow,
    seasonRow,
    compositionRows,
  ] = await Promise.all([
    pfsCatId
      ? prisma.category.findFirst({
          where: { pfsCategoryId: pfsCatId },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    familyLookupValues.length > 0
      ? prisma.category.findFirst({
          where: { pfsFamilyName: { in: familyLookupValues } },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    categoryNameLookups.length > 0
      ? prisma.category.findFirst({
          where: { name: { in: categoryNameLookups } },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    ctryLabelFr
      ? prisma.manufacturingCountry.findFirst({
          where: { pfsCountryRef: ctryLabelFr },
          select: { id: true },
        })
      : Promise.resolve(null),
    seasonRef
      ? prisma.season.findFirst({
          where: { pfsRef: seasonRef },
          select: { id: true },
        })
      : Promise.resolve(null),
    materialEntries.length > 0
      ? prisma.composition.findMany({
          where: { pfsCompositionRef: { in: materialEntries.map((m) => m.label) } },
          select: { id: true, pfsCompositionRef: true },
        })
      : Promise.resolve([]),
  ]);

  const { category, matchedBy } = pickImportCategory(
    primaryCategory,
    fallbackCategory,
    nameFallbackCategory,
  );
  if (!category) {
    const catLabel = product.category?.labels?.fr ?? product.family;
    throw new Error(`Catégorie non mappée : "${catLabel}". Créez d'abord la correspondance.`);
  }
  if (matchedBy === "name") {
    warnings.push(
      `Catégorie associée par nom : "${category.name}" (la référence PFS d'origine semble obsolète — vérifiez la correspondance dans Paramètres > PFS > Catégories).`,
    );
  }

  let manufacturingCountryId: string | null = null;
  if (ctryLabelFr) {
    if (countryRow) manufacturingCountryId = countryRow.id;
    else warnings.push(`Pays "${ctryLabelFr}" non mappé (produit créé sans pays)`);
  }

  const seasonId: string | null = seasonRow?.id ?? null;
  if (seasonRef && !seasonRow) {
    warnings.push(`Saison "${seasonRef}" non mappée (produit créé sans saison)`);
  }

  const compositionByLabel = new Map(compositionRows.map((c) => [c.pfsCompositionRef, c]));
  const compositionsInput: { compositionId: string; percentage: number }[] = [];
  for (const mat of materialEntries) {
    const comp = compositionByLabel.get(mat.label);
    if (comp) compositionsInput.push({ compositionId: comp.id, percentage: mat.percentage });
    else warnings.push(`Composition "${mat.label}" non mappée (ignorée)`);
  }

  let variantsToResolve: PfsVariantItem[] = product.variants ?? [];
  if (variantResponseResult.ok) {
    if (variantResponseResult.data.data?.length > 0) {
      variantsToResolve = variantResponseResult.data.data;
      logger.info("[PFS Import] Using variants endpoint data", { reference, count: variantResponseResult.data.data.length });
    }
  } else {
    logger.warn("[PFS Import] Variants endpoint failed, using listProducts data", {
      reference,
      err: variantResponseResult.err instanceof Error ? variantResponseResult.err.message : String(variantResponseResult.err),
    });
  }

  const productImages = product.images ?? {};
  const resolvedVariants: ResolvedVariant[] = [];
  for (const v of variantsToResolve) {
    try {
      const rv = await resolveVariant(v, warnings, productImages);
      if (rv) resolvedVariants.push(rv);
    } catch (err) {
      warnings.push(`Variante ignorée : ${(err as Error).message}`);
    }
  }
  if (resolvedVariants.length === 0) {
    throw new Error("Aucune variante n'a pu être résolue (vérifiez les correspondances couleurs/tailles).");
  }

  const name = product.labels?.fr ?? product.labels?.en ?? product.reference;
  const description = detail?.description?.fr ?? detail?.description?.en ?? "";
  const nameEn = pickEnLabel(product.labels);
  const descriptionEn = pickEnLabel(detail?.description);

  throwIfCancelled(isCancelled);

  const detectedPrimaryColorId = findPrimaryColorIdFromPfs({
    variants: resolvedVariants,
    defaultColor: detail?.default_color,
    productImages,
  });
  const fallbackPrimaryColorId =
    resolvedVariants.find((rv) => rv.allColorIds.length > 0)?.allColorIds[0] ??
    resolvedVariants[0]?.colorId ??
    null;
  const initialPrimaryColorId = detectedPrimaryColorId ?? fallbackPrimaryColorId;
  if (!detectedPrimaryColorId && detail?.default_color) {
    warnings.push(`Couleur par défaut PFS "${detail.default_color}" non reconnue — couleur principale par défaut`);
  }

  const usesTailleUnique = variantsToResolve.some((v) => {
    if (v.item?.size === PROTECTED_SIZE_PFS_REF) return true;
    return (v.packs ?? []).some((pk) =>
      (pk.sizes ?? []).some((sz) => sz.size === PROTECTED_SIZE_PFS_REF),
    );
  });
  const rawSizeDetailsTu = product.size_details_tu?.trim() || null;
  const sizeDetailsTuValue =
    rawSizeDetailsTu ?? (usesTailleUnique ? "0" : null);

  const colorNameMap = new Map<string, string>();
  const uniqueColorIds = Array.from(
    new Set(resolvedVariants.flatMap((rv) => rv.allColorIds.length > 0 ? rv.allColorIds : [rv.colorId])),
  );
  if (uniqueColorIds.length > 0) {
    const dbColors = await prisma.color.findMany({
      where: { id: { in: uniqueColorIds } },
      select: { id: true, name: true },
    });
    for (const c of dbColors) colorNameMap.set(c.id, c.name);
  }

  const primaryIndex = findPrimaryVariantIndex(
    resolvedVariants,
    detail?.default_color,
    productImages,
    reference,
    warnings,
  );

  const pfsFinalStatus = pfsStatusToBjStatus(product.status);

  const plannedVariants = resolvedVariants.map((rv, i) => ({
    localId: `local-${i}`,
    rv,
    index: i,
    isPrimary: i === primaryIndex,
  }));

  throwIfCancelled(isCancelled);
  const downloadedImages = await downloadAllVariantImagesToBuffers(
    pfsId,
    reference,
    colorNameMap,
    plannedVariants.map((pv) => ({
      id: pv.localId,
      colorId: pv.rv.colorId,
      pfsVariant: pv.rv,
    })),
    { isCancelled },
  );

  const { status: finalStatus, missingColorIds: colorsMissingImages } =
    applyMissingImageDowngrade(
      pfsFinalStatus,
      plannedVariants.map((pv) => pv.rv.colorId),
      downloadedImages.map((di) => di.img.colorId),
    );
  if (pfsFinalStatus === "ONLINE" && finalStatus === "OFFLINE") {
    const missingNames = colorsMissingImages
      .map((cid) => colorNameMap.get(cid) ?? cid)
      .join(", ");
    warnings.push(
      `Produit basculé en OFFLINE car ${colorsMissingImages.length} couleur(s) sans image : ${missingNames}`,
    );
  }

  const destDir = `public/${productImageDir(reference)}`;
  type ProcessedImage = {
    localVariantId: string;
    colorId: string;
    order: number;
    dbPath: string;
  };
  const processedImages: ProcessedImage[] = [];

  try {
    for (const di of downloadedImages) {
      throwIfCancelled(isCancelled);
      const colorName = colorNameMap.get(di.img.colorId) ?? null;
      const filename = productImageBaseName(reference, colorName, di.img.order + 1);
      const { dbPath } = await processProductImage(di.body, destDir, filename);
      processedImages.push({
        localVariantId: di.img.variantId,
        colorId: di.img.colorId,
        order: di.img.order,
        dbPath,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const productRow = await tx.product.create({
        data: {
          reference,
          name,
          description,
          categoryId: category.id,
          status: finalStatus,
          isIncomplete: false,
          manufacturingCountryId,
          seasonId,
          pfsProductId: product.id,
          // Chaque produit PFS connaît sa marque — on la stocke pour
          // l'afficher dans le badge et garder une trace fiable.
          pfsBrandId: product.brand?.id ?? null,
          pfsBrandName: product.brand?.name ?? null,
          sizeDetailsTu: sizeDetailsTuValue,
          primaryColorId: initialPrimaryColorId,
          compositions: {
            create: compositionsInput.map((c) => ({ compositionId: c.compositionId, percentage: c.percentage })),
          },
        },
        select: { id: true, reference: true, name: true },
      });

      const localToDbId = new Map<string, string>();

      for (const pv of plannedVariants) {
        const skuColorIds = pv.rv.allColorIds.length > 0 ? pv.rv.allColorIds : [pv.rv.colorId];
        const skuColorNames = skuColorIds.map((id) => colorNameMap.get(id) ?? "COLOR");
        const variant = await tx.productColor.create({
          data: {
            productId: productRow.id,
            colorId: pv.rv.colorId,
            unitPrice: pv.rv.unitPrice,
            weight: pv.rv.weight,
            stock: pv.rv.stock,
            isPrimary: pv.isPrimary,
            saleType: pv.rv.saleType,
            packQuantity: pv.rv.packQuantity,
            sku: generateSku(reference, skuColorNames, pv.rv.saleType, pv.index + 1),
            pfsVariantId: pv.rv.pfsVariantId,
          },
          select: { id: true },
        });
        localToDbId.set(pv.localId, variant.id);

        if (pv.rv.packLines.length > 0) {
          for (let li = 0; li < pv.rv.packLines.length; li++) {
            const line = pv.rv.packLines[li];
            await tx.packColorLine.create({
              data: {
                productColorId: variant.id,
                colorId: line.colorId,
                position: li,
                sizes: {
                  create: line.sizeEntries.map((se) => ({
                    sizeId: se.sizeId,
                    quantity: se.quantity,
                  })),
                },
              },
            });
          }
        } else if (pv.rv.sizeEntries.length > 0) {
          await tx.variantSize.createMany({
            data: pv.rv.sizeEntries.map((se) => ({
              productColorId: variant.id,
              sizeId: se.sizeId,
              quantity: se.quantity,
            })),
          });
        }
      }

      if (processedImages.length > 0) {
        await tx.productColorImage.createMany({
          data: processedImages.map((pi) => {
            const dbVariantId = localToDbId.get(pi.localVariantId);
            if (!dbVariantId) throw new Error(`Mapping localId→dbId manquant pour ${pi.localVariantId}`);
            return {
              productId: productRow.id,
              colorId: pi.colorId,
              productColorId: dbVariantId,
              path: pi.dbPath,
              order: pi.order,
            };
          }),
        });
      }

      return productRow;
    }, { timeout: 30000 });

    logger.info("[PFS Import] Produit créé avec images", {
      productId: created.id, reference, status: finalStatus,
    });

    emitProductEvent({
      type: "PRODUCT_CREATED",
      productId: created.id,
    });

    if (nameEn || descriptionEn) {
      await prisma.productTranslation.upsert({
        where: { productId_locale: { productId: created.id, locale: "en" } },
        update: { name: nameEn ?? "", description: descriptionEn ?? "" },
        create: {
          productId: created.id,
          locale: "en",
          name: nameEn ?? "",
          description: descriptionEn ?? "",
        },
      });
      autoTranslateProduct(created.id, name, description, ["en"]);
    } else {
      autoTranslateProduct(created.id, name, description);
    }

    return {
      productId: created.id,
      reference: created.reference,
      name: created.name,
      warnings,
    };
  } catch (err) {
    const cancelled = err instanceof PfsImportCancelledError;
    const errMsg = err instanceof Error ? err.message : String(err);
    if (cancelled) {
      logger.info("[PFS Import] Import cancelled, cleaning up disk", { reference });
    } else {
      logger.error("[PFS Import] Import failed, cleaning up disk", { reference, err: errMsg });
    }
    try {
      await deleteDirectory(productImageDir(reference));
    } catch (cleanupErr) {
      logger.warn("[PFS Import] Disk cleanup failed", {
        reference, err: (cleanupErr as Error).message,
      });
    }
    if (cancelled) throw err;
    throw new Error(`Import échoué pour ${reference} : ${errMsg}`);
  }
}

async function resolveColorIdForPfsInfo(c: PfsColorInfo): Promise<string | null> {
  const candidates = pfsColorMatchCandidates(c);
  for (const candidate of candidates) {
    const found = await prisma.color.findFirst({
      where: { name: candidate },
      select: { id: true, hex: true },
    });
    if (!found) continue;
    // PFS fournit un hex officiel (`c.value` ex: "#595F34" pour Kaki). Si la
    // couleur locale n'en a pas, on la complète maintenant — sinon l'aperçu
    // de couleur dans la modale d'images retombe sur le gris par défaut. On
    // ne touche jamais à un hex déjà saisi par l'admin.
    const pfsHex = normalizePfsHex(c.value);
    if (pfsHex && !found.hex) {
      await prisma.color.update({
        where: { id: found.id },
        data: { hex: pfsHex },
      });
    }
    return found.id;
  }
  return null;
}

async function resolveSizeEntries(
  sizes: { size: string; qty: number }[],
  warnings: string[],
  variantId: string,
): Promise<{ sizeId: string; quantity: number }[]> {
  const out: { sizeId: string; quantity: number }[] = [];
  for (const s of sizes) {
    const size = await prisma.size.findFirst({
      where: { pfsSizeRef: s.size },
      select: { id: true },
    });
    if (size) out.push({ sizeId: size.id, quantity: s.qty });
    else warnings.push(`Taille "${s.size}" non mappée (ignorée pour variante ${variantId})`);
  }
  return out;
}

async function resolveVariant(
  v: PfsVariantItem,
  warnings: string[],
  productImages: Record<string, string | string[]> = {},
): Promise<ResolvedVariant | null> {
  const colors: PfsColorInfo[] = v.item
    ? [v.item.color]
    : (v.packs ?? []).map((pk) => pk.color);
  if (colors.length === 0 || !colors[0]?.reference) return null;

  const colorRef = colors[0].reference;

  // PFS envoie un code anglais (ex: "DARK_GRAY") + des libellés traduits
  // (labels.fr = "Gris Foncé", labels.en = "Dark Gray", ...). Les couleurs en
  // bibliothèque sont nommées en français → on tente d'abord les libellés
  // (fr, en, de, es, it) puis on retombe sur le code brut.

  let resolvedSizeEntries: { sizeId: string; quantity: number }[];
  let resolvedPackLines: { colorId: string; sizeEntries: { sizeId: string; quantity: number }[] }[];
  let resolvedAllColorIds: string[];
  let primaryColorId: string;
  // Couples (couleur PFS, colorId local) dans l'ordre d'apparition, dédupliqués
  // par colorId. Sert ensuite à collecter les images couleur par couleur.
  const colorPairs: { localColorId: string; pfsColor: PfsColorInfo }[] = [];
  const seenLocalColorIds = new Set<string>();
  const pushPair = (localColorId: string, pfsColor: PfsColorInfo) => {
    if (seenLocalColorIds.has(localColorId)) return;
    seenLocalColorIds.add(localColorId);
    colorPairs.push({ localColorId, pfsColor });
  };

  if (v.item) {
    // UNIT : une seule couleur, une seule taille.
    const primary = await resolveColorIdForPfsInfo(v.item.color);
    if (!primary) {
      const candidates = pfsColorMatchCandidates(v.item.color);
      throw new Error(
        `Couleur "${colorRef}" introuvable dans la bibliothèque (essayé : ${candidates.join(", ")})`,
      );
    }
    primaryColorId = primary;
    pushPair(primary, v.item.color);
    resolvedSizeEntries = await resolveSizeEntries(
      v.item.size ? [{ size: v.item.size, qty: 1 }] : [],
      warnings,
      v.id,
    );
    resolvedPackLines = [];
    resolvedAllColorIds = [primary];
  } else {
    // PACK : mono ou multi-couleurs. On résout chaque ligne de pack séparément
    // (couleur + ses tailles), puis on laisse `buildPackLinesFromResolved`
    // décider de la forme finale (mono vs multi-couleurs).
    const resolvedPacks: { colorId: string; sizeEntries: { sizeId: string; quantity: number }[] }[] = [];
    for (const pk of v.packs ?? []) {
      const colorId = await resolveColorIdForPfsInfo(pk.color);
      if (!colorId) {
        const candidates = pfsColorMatchCandidates(pk.color);
        throw new Error(
          `Couleur "${pk.color.reference}" introuvable dans la bibliothèque (essayé : ${candidates.join(", ")})`,
        );
      }
      pushPair(colorId, pk.color);
      const sizeEntries = await resolveSizeEntries(
        (pk.sizes ?? []).map((sz) => ({ size: sz.size, qty: sz.qty })),
        warnings,
        v.id,
      );
      resolvedPacks.push({ colorId, sizeEntries });
    }
    const built = buildPackLinesFromResolved(resolvedPacks);
    resolvedSizeEntries = built.sizeEntries;
    resolvedPackLines = built.packLines;
    resolvedAllColorIds = built.allColorIds;
    primaryColorId =
      built.allColorIds[0] ?? resolvedPacks[0]?.colorId ?? "";
    if (!primaryColorId) return null;
  }

  // Collecte les images de **chaque** couleur de la variante. Pour un pack
  // multi-couleurs (ex: BROWN+KAKI), on récupère les photos KAKI sous leur
  // propre `colorId` afin qu'elles s'affichent dans l'onglet Kaki du modal
  // d'images, et non sous l'onglet Brun.
  const imagesByColor = buildVariantImagesByColor(colorPairs, v.images, productImages);

  // Mapping PFS → local pour chaque couleur de la variante. Permet plus tard
  // de retrouver le bon colorId à partir d'un default_color PFS — y compris
  // quand celui-ci pointe vers une couleur "secondaire" d'un pack multi.
  const pfsColorMappings = colorPairs.map(({ localColorId, pfsColor }) => ({
    reference: pfsColor.reference,
    labels: Object.values(pfsColor.labels ?? {}).filter((l): l is string => typeof l === "string" && l.length > 0),
    localId: localColorId,
  }));

  const primaryColorLabels = Object.values(colors[0]?.labels ?? {})
    .filter((l): l is string => typeof l === "string" && l.length > 0)
    .map(normalizeKey);

  return {
    colorId: primaryColorId,
    pfsVariantId: v.id,
    unitPrice: v.price_sale?.total?.value ?? v.price_sale?.unit?.value ?? 0,
    weight: v.weight ?? 0,
    stock: v.stock_qty ?? 0,
    saleType: v.type === "PACK" ? "PACK" : "UNIT",
    packQuantity: v.type === "PACK" ? (v.pieces ?? 1) : null,
    primaryPfsColorRef: colorRef,
    primaryColorLabels,
    isStar: v.is_star === true,
    sizeEntries: resolvedSizeEntries,
    packLines: resolvedPackLines,
    allColorIds: resolvedAllColorIds,
    imagesByColor,
    pfsColorMappings,
  };
}

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

/**
 * Nombre d'images téléchargées en parallèle pour un même produit via Playwright.
 * Au-delà de 3, le risque de 429/connection reset côté CDN PFS augmente
 * et la mémoire Chromium grimpe vite (~80 Mo par page).
 */
const IMAGE_DOWNLOAD_CONCURRENCY = 3;

/**
 * Nombre d'images téléchargées en parallèle via fetch HTTP direct (passe rapide).
 * Pas de coût mémoire navigateur → on peut monter beaucoup plus haut.
 * 8 reste prudent pour ne pas saturer le CDN PFS sur de gros lots.
 */
const HTTP_IMAGE_DOWNLOAD_CONCURRENCY = 8;

/**
 * Headers HTTP utilisés pour la passe fetch directe. Mime un Chrome récent
 * pour rester cohérent avec le BROWSER_PROFILE_A — quelques CDN refusent les
 * User-Agents génériques (Node, curl…).
 */
const HTTP_IMAGE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Sec-Fetch-Dest": "image",
  "Sec-Fetch-Mode": "no-cors",
  "Sec-Fetch-Site": "cross-site",
};

/** Timeout fetch images PFS (ms). Au-delà on considère qu'un Chromium a une
 *  meilleure chance de réussir et on bascule la passe Playwright. */
const HTTP_IMAGE_TIMEOUT_MS = 20000;

// Profils navigateur distincts pour les 2 passes
const BROWSER_PROFILE_A = {
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
  locale: "fr-FR",
  extraHTTPHeaders: {
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Ch-Ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  },
};

const BROWSER_PROFILE_B = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  extraHTTPHeaders: {
    "Accept": "image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
  },
};

type PendingImage = PlannedImage;

export type DownloadedImage = {
  img: PendingImage;
  body: Buffer;
};

/**
 * Télécharge les images d'un produit en 3 passes (HTTP → Chromium A → Chromium B)
 * et retourne les buffers en RAM. Aucune écriture disque/BDD ici — c'est l'appelant
 * (cf. Task 4) qui décide quoi faire des buffers une fois tous les téléchargements OK.
 * Si des images échouent après les 3 passes → erreur (le produit sera supprimé).
 */
async function downloadAllVariantImagesToBuffers(
  productId: string,
  reference: string,
  colorNames: Map<string, string>,
  variants: { id: string; colorId: string; pfsVariant: ResolvedVariant }[],
  options?: ImportCancellationOptions,
): Promise<DownloadedImage[]> {
  const isCancelled = options?.isCancelled;
  const { chromium } = await import("playwright");

  // Construit la liste d'images à télécharger via le helper extrait :
  // dédoublonnage par colorId, photos KAKI d'un pack BROWN+KAKI rattachées
  // à leur propre colorId pour s'afficher dans l'onglet Kaki.
  const allImages: PendingImage[] = planVariantImageDownloads(
    variants.map((v) => ({ id: v.id, imagesByColor: v.pfsVariant.imagesByColor })),
  );

  if (allImages.length === 0) {
    throwIfCancelled(isCancelled);
    return [];
  }

  throwIfCancelled(isCancelled);

  // ── Passe 1 : fetch HTTP direct (rapide, pas de Chromium)
  const passHttp = await downloadImageBatchHttp(
    productId, reference, colorNames, allImages, "HTTP", { isCancelled },
  );
  const downloaded: DownloadedImage[] = [...passHttp.downloaded];
  let failed = passHttp.failed;

  logger.info("[PFS Import] Pass HTTP done", {
    productId,
    total: allImages.length,
    ok: passHttp.downloaded.length,
    failed: failed.length,
  });

  throwIfCancelled(isCancelled);

  // ── Passe 2 : Chromium A
  if (failed.length > 0) {
    const browserA = await chromium.launch({ headless: true });
    try {
      const ctxA = await browserA.newContext(BROWSER_PROFILE_A);
      const passA = await downloadImageBatch(
        ctxA, productId, reference, colorNames, failed, "A", { isCancelled },
      );
      downloaded.push(...passA.downloaded);
      failed = passA.failed;
      await ctxA.close();
    } finally {
      await browserA.close();
    }

    logger.info("[PFS Import] Pass A done", {
      productId,
      remaining: failed.length,
    });
  }

  throwIfCancelled(isCancelled);

  // ── Passe 3 : Chromium B avec retries
  if (failed.length > 0) {
    const browserB = await chromium.launch({ headless: true });
    try {
      const ctxB = await browserB.newContext(BROWSER_PROFILE_B);
      let stillFailing = failed;

      for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS && stillFailing.length > 0; attempt++) {
        throwIfCancelled(isCancelled);
        logger.info("[PFS Import] Pass B retry", {
          productId, attempt, remaining: stillFailing.length,
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        throwIfCancelled(isCancelled);
        const passB = await downloadImageBatch(
          ctxB, productId, reference, colorNames, stillFailing, "B", { isCancelled },
        );
        downloaded.push(...passB.downloaded);
        stillFailing = passB.failed;
      }

      await ctxB.close();

      if (stillFailing.length > 0) {
        const urls = stillFailing.map((img) => img.url).join(", ");
        throw new Error(
          `${stillFailing.length} image(s) impossible(s) à télécharger après ${RETRY_MAX_ATTEMPTS} tentatives : ${urls}`,
        );
      }
    } finally {
      await browserB.close();
    }
  }

  logger.info("[PFS Import] Toutes les images téléchargées en RAM", {
    productId, count: downloaded.length,
  });

  return downloaded;
}

/**
 * Télécharge un lot d'images via fetch HTTP direct — sans navigateur, donc
 * sans coût mémoire Chromium (chaque page ~80 Mo).
 *
 * Concurrence : pool de `HTTP_IMAGE_DOWNLOAD_CONCURRENCY` workers. Bien plus
 * léger que Playwright donc on peut monter à 8.
 *
 * Ne bloque jamais sur un échec — continue et renvoie la liste des échecs
 * (qui seront repris par les passes Playwright A puis B en filet de sécurité).
 *
 * Exporté pour les tests unitaires uniquement. `fetchImpl` injectable pour
 * isoler les tests du global fetch.
 */
export async function downloadImageBatchHttp(
  productId: string,
  reference: string,
  colorNames: Map<string, string>,
  images: PendingImage[],
  passLabel: string,
  options?: ImportCancellationOptions & { fetchImpl?: typeof fetch },
): Promise<{ downloaded: DownloadedImage[]; failed: PendingImage[] }> {
  const isCancelled = options?.isCancelled;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const downloaded: DownloadedImage[] = [];
  const failed: PendingImage[] = [];
  let nextIndex = 0;

  const downloadOne = async (img: PendingImage): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_IMAGE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(img.url, {
        method: "GET",
        headers: HTTP_IMAGE_HEADERS,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const arrayBuf = await res.arrayBuffer();
      const body = Buffer.from(arrayBuf);
      if (body.length === 0) throw new Error("Empty response body");

      downloaded.push({ img, body });

      logger.info(`[PFS Import] [${passLabel}] Image downloaded`, {
        productId, variant: img.variantId, order: img.order,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      throwIfCancelled(isCancelled);
      const i = nextIndex++;
      if (i >= images.length) return;
      const img = images[i];
      try {
        await downloadOne(img);
      } catch (err) {
        if (err instanceof PfsImportCancelledError) throw err;
        logger.warn(`[PFS Import] [${passLabel}] Image failed`, {
          url: img.url, err: (err as Error).message,
        });
        failed.push(img);
      }
    }
  };

  const workerCount = Math.min(HTTP_IMAGE_DOWNLOAD_CONCURRENCY, images.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  void productId; void reference; void colorNames;

  return { downloaded, failed };
}

/**
 * Télécharge un lot d'images via un contexte Playwright.
 *
 * Optimisations :
 *   1. Téléchargements en parallèle (pool de `IMAGE_DOWNLOAD_CONCURRENCY` workers)
 *   2. Une page Playwright par worker, réutilisée pour toutes les images du
 *      worker (au lieu d'ouvrir/fermer une page par image).
 *
 * Ne bloque jamais sur un échec — continue et renvoie la liste des échecs.
 *
 * Exporté pour les tests unitaires uniquement.
 */
export async function downloadImageBatch(
  context: import("playwright").BrowserContext,
  productId: string,
  reference: string,
  colorNames: Map<string, string>,
  images: PendingImage[],
  passLabel: string,
  options?: ImportCancellationOptions,
): Promise<{ downloaded: DownloadedImage[]; failed: PendingImage[] }> {
  const isCancelled = options?.isCancelled;
  const downloaded: DownloadedImage[] = [];
  const failed: PendingImage[] = [];
  let nextIndex = 0;

  const downloadOne = async (
    page: import("playwright").Page,
    img: PendingImage,
  ): Promise<void> => {
    const response = await page.goto(img.url, { waitUntil: "load", timeout: 30000 });
    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status() ?? "no response"}`);
    }
    const body = await response.body();
    if (!body || body.length === 0) throw new Error("Empty response body");

    downloaded.push({ img, body });

    logger.info(`[PFS Import] [${passLabel}] Image downloaded`, {
      productId, variant: img.variantId, order: img.order,
    });
  };

  const worker = async (): Promise<void> => {
    const page = await context.newPage();
    try {
      while (true) {
        throwIfCancelled(isCancelled);
        const i = nextIndex++;
        if (i >= images.length) return;
        const img = images[i];
        try {
          await downloadOne(page, img);
        } catch (err) {
          if (err instanceof PfsImportCancelledError) throw err;
          logger.warn(`[PFS Import] [${passLabel}] Image failed`, {
            url: img.url, err: (err as Error).message,
          });
          failed.push(img);
        }
      }
    } finally {
      await page.close().catch(() => { /* page peut déjà être fermée */ });
    }
  };

  const workerCount = Math.min(IMAGE_DOWNLOAD_CONCURRENCY, images.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  void reference; void colorNames;

  return { downloaded, failed };
}

