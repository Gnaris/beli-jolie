/**
 * PFS Import — Logique métier
 *
 * Parcours en 3 étapes :
 *   1. Collecte les attributs PFS utilisés par le catalogue + vérifie s'ils sont mappés chez nous
 *   2. Liste les produits PFS dont la référence n'existe pas encore chez nous
 *   3. Approbation d'un produit : création immédiate en statut SYNCING, puis
 *      téléchargement des images en arrière-plan (SYNCING → IMPORTED une fois prêt)
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
import { processProductImage } from "@/lib/image-processor";
import { getImagePaths } from "@/lib/image-utils";
import { r2KeyFromDbPath, deleteMultipleFromR2 } from "@/lib/r2";
import { emitProductEvent } from "@/lib/product-events";
import { generateSku } from "@/lib/sku";

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
  mapped: boolean;
  localId?: string;
  localName?: string;
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

// ─────────────────────────────────────────────
// Helpers internes
// ─────────────────────────────────────────────

const PFS_LIST_PAGE_SIZE = 100;
const DEEP_SCAN_SAMPLE_SIZE = 50; // nb de produits inspectés en profondeur (checkReference) pour composition / pays / saison

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

function countryLabel(code: string): string {
  const upper = code.trim().toUpperCase();
  return COUNTRY_LABELS_FR[upper] ?? code;
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
}): Promise<PfsAttributeScan> {
  const maxImportable = options?.maxImportable;
  const deepSampleSize = options?.deepSampleSize ?? DEEP_SCAN_SAMPLE_SIZE;

  // Charge les pages PFS et filtre pour ne garder que les produits importables
  // (pas encore dans notre DB). Si maxImportable=23, on obtient exactement 23 produits.
  const allLoaded: PfsProduct[] = [];
  const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE);
  allLoaded.push(...first.data);
  const totalPages = first.meta?.last_page ?? 1;

  // Filtre : ne garder que les produits pas encore chez nous
  let products = await filterImportable(allLoaded);

  // Charger plus de pages si on n'a pas assez de produits importables
  for (let p = 2; p <= totalPages; p++) {
    if (maxImportable && products.length >= maxImportable) break;
    const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE);
    if (pageData.data.length === 0) break;
    allLoaded.push(...pageData.data);
    products = await filterImportable(allLoaded);
  }

  // Limite au nombre demandé
  if (maxImportable && products.length > maxImportable) {
    products = products.slice(0, maxImportable);
  }

  // Collecte des attributs "peu coûteux" (visibles dans listProducts)
  const rawCategories: { pfsRef: string; label: string }[] = [];
  const rawColors: { pfsRef: string; label: string }[] = [];
  const rawSizes: { pfsRef: string; label: string }[] = [];

  for (const prod of products) {
    // catégorie = category.id PFS (le type précis : Bagues, Boucles d'oreilles, etc.)
    // et non family (le groupe large : Bijoux_Fantaisie) qui est identique pour tout
    if (prod.category?.id) {
      const catLabel = prod.category.labels?.fr ?? prod.category.labels?.en ?? prod.family;
      rawCategories.push({ pfsRef: prod.category.id, label: catLabel });
    } else if (prod.family) {
      rawCategories.push({ pfsRef: prod.family, label: prod.family });
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
          rawColors.push({ pfsRef: col.reference, label: frLabel });
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
  const rawCompositions: { pfsRef: string; label: string }[] = [];
  const rawCountries: { pfsRef: string; label: string }[] = [];
  const rawSeasons: { pfsRef: string; label: string }[] = [];

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
        rawCompositions.push({ pfsRef: mat.reference, label });
      }

      if (detail.country_of_manufacture) {
        rawCountries.push({
          pfsRef: detail.country_of_manufacture,
          label: countryLabel(detail.country_of_manufacture),
        });
      }

      if (detail.collection?.reference) {
        const seasonLabel = detail.collection.labels?.fr ?? detail.collection.labels?.en ?? detail.collection.reference;
        rawSeasons.push({ pfsRef: detail.collection.reference, label: seasonLabel });
      }
    }
  }

  const categories = uniqueMap(rawCategories, (x) => x.pfsRef);
  const colors = uniqueMap(rawColors, (x) => x.pfsRef);
  const sizes = uniqueMap(rawSizes, (x) => x.pfsRef);
  const compositions = uniqueMap(rawCompositions, (x) => x.pfsRef);
  const countries = uniqueMap(rawCountries, (x) => x.pfsRef);
  const seasons = uniqueMap(rawSeasons, (x) => x.pfsRef);

  // Vérification du mapping dans notre DB
  const [localCategories, localColors, localSizes, localCompositions, localCountries, localSeasons] = await Promise.all([
    prisma.category.findMany({
      where: { pfsCategoryId: { in: categories.map((c) => c.pfsRef) } },
      select: { id: true, name: true, pfsCategoryId: true },
    }),
    prisma.color.findMany({
      where: { pfsColorRef: { in: colors.map((c) => c.pfsRef) } },
      select: { id: true, name: true, pfsColorRef: true },
    }),
    prisma.size.findMany({
      where: { pfsSizeRef: { in: sizes.map((s) => s.pfsRef) } },
      select: { id: true, name: true, pfsSizeRef: true },
    }),
    prisma.composition.findMany({
      where: { pfsCompositionRef: { in: compositions.map((c) => c.pfsRef) } },
      select: { id: true, name: true, pfsCompositionRef: true },
    }),
    prisma.manufacturingCountry.findMany({
      where: { pfsCountryRef: { in: countries.map((c) => c.pfsRef) } },
      select: { id: true, name: true, pfsCountryRef: true },
    }),
    prisma.season.findMany({
      where: { pfsRef: { in: seasons.map((s) => s.pfsRef) } },
      select: { id: true, name: true, pfsRef: true },
    }),
  ]);

  const catMap = new Map(localCategories.map((c) => [c.pfsCategoryId!, c]));
  const colMap = new Map(localColors.map((c) => [c.pfsColorRef!, c]));
  const szMap = new Map(localSizes.map((s) => [s.pfsSizeRef!, s]));
  const cpMap = new Map(localCompositions.map((c) => [c.pfsCompositionRef!, c]));
  const ctryMap = new Map(localCountries.map((c) => [c.pfsCountryRef!, c]));
  const seaMap = new Map(localSeasons.map((s) => [s.pfsRef!, s]));

  const out: PfsAttribute[] = [];

  for (const c of categories) {
    const local = catMap.get(c.pfsRef);
    out.push({ type: "category", pfsRef: c.pfsRef, label: c.label, mapped: !!local, localId: local?.id, localName: local?.name });
  }
  for (const c of colors) {
    const local = colMap.get(c.pfsRef);
    out.push({ type: "color", pfsRef: c.pfsRef, label: c.label, mapped: !!local, localId: local?.id, localName: local?.name });
  }
  for (const s of sizes) {
    const local = szMap.get(s.pfsRef);
    out.push({ type: "size", pfsRef: s.pfsRef, label: s.label, mapped: !!local, localId: local?.id, localName: local?.name });
  }
  for (const c of compositions) {
    const local = cpMap.get(c.pfsRef);
    out.push({ type: "composition", pfsRef: c.pfsRef, label: c.label, mapped: !!local, localId: local?.id, localName: local?.name });
  }
  for (const c of countries) {
    const local = ctryMap.get(c.pfsRef);
    out.push({ type: "country", pfsRef: c.pfsRef, label: c.label, mapped: !!local, localId: local?.id, localName: local?.name });
  }
  for (const s of seasons) {
    const local = seaMap.get(s.pfsRef);
    out.push({ type: "season", pfsRef: s.pfsRef, label: s.label, mapped: !!local, localId: local?.id, localName: local?.name });
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
  // Lier à une entité existante au lieu de créer (facultatif)
  linkToExistingId?: string;
}

export interface CreateMappingResult {
  id: string;
  name: string;
  created: boolean; // true = entité créée, false = entité existante liée
}

export async function createOrLinkMapping(input: CreateMappingInput): Promise<CreateMappingResult> {
  const { type, pfsRef, label, linkToExistingId } = input;

  switch (type) {
    case "category": {
      if (linkToExistingId) {
        const upd = await prisma.category.update({
          where: { id: linkToExistingId },
          data: { pfsCategoryId: pfsRef, pfsCategoryName: label },
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      const slug = label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const created = await prisma.category.create({
        data: { name: label, slug, pfsCategoryId: pfsRef, pfsCategoryName: label },
        select: { id: true, name: true },
      });
      return { id: created.id, name: created.name, created: true };
    }

    case "color": {
      if (linkToExistingId) {
        const upd = await prisma.color.update({
          where: { id: linkToExistingId },
          data: { pfsColorRef: pfsRef },
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      const created = await prisma.color.create({
        data: { name: label, pfsColorRef: pfsRef, hex: null },
        select: { id: true, name: true },
      });
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
      const created = await prisma.composition.create({
        data: { name: label, pfsCompositionRef: pfsRef },
        select: { id: true, name: true },
      });
      return { id: created.id, name: created.name, created: true };
    }

    case "country": {
      if (linkToExistingId) {
        const upd = await prisma.manufacturingCountry.update({
          where: { id: linkToExistingId },
          data: { pfsCountryRef: pfsRef },
          select: { id: true, name: true },
        });
        return { id: upd.id, name: upd.name, created: false };
      }
      const created = await prisma.manufacturingCountry.create({
        data: { name: label, pfsCountryRef: pfsRef, isoCode: pfsRef.length <= 3 ? pfsRef.toUpperCase() : null },
        select: { id: true, name: true },
      });
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
      const created = await prisma.season.create({
        data: { name: label, pfsRef },
        select: { id: true, name: true },
      });
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

  // Charge page par page, filtre ceux déjà chez nous, s'arrête quand on a le compte
  const importable: PfsProduct[] = [];
  const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE);
  const totalPages = first.meta?.last_page ?? 1;

  // Filtre la première page
  const firstFiltered = await filterImportable(first.data);
  importable.push(...firstFiltered);

  // Continue page par page jusqu'à avoir assez
  for (let p = 2; p <= totalPages; p++) {
    if (maxProducts && importable.length >= maxProducts) break;
    const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE);
    if (pageData.data.length === 0) break;
    const filtered = await filterImportable(pageData.data);
    importable.push(...filtered);
  }

  // Limite au nombre demandé
  const result = maxProducts ? importable.slice(0, maxProducts) : importable;

  return result.map((p) => ({
    pfsId: p.id,
    reference: p.reference,
    name: p.labels?.fr ?? p.labels?.en ?? p.reference,
    category: p.family ?? "",
    family: p.family ?? "",
    colorCount: (p.colors ?? "").split(";").filter((c) => c.trim()).length,
    variantCount: p.count_variants ?? 0,
    defaultImage: pickDefaultImage(p.images),
  }));
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

interface ResolvedVariant {
  colorId: string;
  unitPrice: number;
  weight: number;
  stock: number;
  saleType: "UNIT" | "PACK";
  packQuantity: number | null;
  pfsColorRef: string | null;
  sizeEntries: { sizeId: string; quantity: number }[];
  imageUrls: string[];
}

/**
 * Approuve un produit PFS : crée le Product en DB avec status SYNCING,
 * puis déclenche le téléchargement des images en arrière-plan.
 * Passe en IMPORTED une fois les images prêtes.
 */
export async function approveAndImportPfsProduct(pfsId: string): Promise<ApprovePfsProductResult> {
  // Charge le produit PFS complet (liste + détails)
  // On recherche dans la liste pour récupérer les variantes / images
  // Note : en v1 on recharge listProducts pour récupérer le produit — peu optimal mais suffisant
  const warnings: string[] = [];

  const list = await pfsListProducts(1, PFS_LIST_PAGE_SIZE);
  let product: PfsProduct | undefined = list.data.find((p) => p.id === pfsId);
  if (!product) {
    const totalPages = list.meta?.last_page ?? 1;
    for (let p = 2; p <= totalPages && !product; p++) {
      const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE);
      product = pageData.data.find((x) => x.id === pfsId);
    }
  }
  if (!product) throw new Error(`Produit PFS introuvable : ${pfsId}`);

  const reference = product.reference.trim().toUpperCase();
  const existing = await prisma.product.findUnique({ where: { reference } });
  if (existing) throw new Error(`Produit déjà importé : ${reference}`);

  // Détails produit (composition, pays, saison, description)
  const refData = await pfsCheckReference(product.reference);
  const detail = refData.product;

  // Résolution catégorie — cherche par pfsCategoryId (précis), sinon par pfsFamilyName (legacy)
  const pfsCatId = product.category?.id;
  const category = await prisma.category.findFirst({
    where: pfsCatId
      ? { OR: [{ pfsCategoryId: pfsCatId }, { pfsFamilyName: product.family }] }
      : { pfsFamilyName: product.family },
    select: { id: true, name: true },
  });
  if (!category) {
    const catLabel = product.category?.labels?.fr ?? product.family;
    throw new Error(`Catégorie non mappée : "${catLabel}". Créez d'abord la correspondance.`);
  }

  // Résolution pays (facultatif)
  let manufacturingCountryId: string | null = null;
  if (detail?.country_of_manufacture) {
    const c = await prisma.manufacturingCountry.findFirst({
      where: { pfsCountryRef: detail.country_of_manufacture },
      select: { id: true },
    });
    if (c) manufacturingCountryId = c.id;
    else warnings.push(`Pays "${detail.country_of_manufacture}" non mappé (produit créé sans pays)`);
  }

  // Résolution saison (facultatif)
  let seasonId: string | null = null;
  if (detail?.collection?.reference) {
    const s = await prisma.season.findFirst({
      where: { pfsRef: detail.collection.reference },
      select: { id: true },
    });
    if (s) seasonId = s.id;
    else warnings.push(`Saison "${detail.collection.reference}" non mappée (produit créé sans saison)`);
  }

  // Résolution compositions
  const compositionsInput: { compositionId: string; percentage: number }[] = [];
  for (const mat of detail?.material_composition ?? []) {
    const comp = await prisma.composition.findFirst({
      where: { pfsCompositionRef: mat.reference },
      select: { id: true },
    });
    if (comp) compositionsInput.push({ compositionId: comp.id, percentage: mat.percentage });
    else warnings.push(`Composition "${mat.reference}" non mappée (ignorée)`);
  }

  // Récupère les variantes depuis l'endpoint dédié (données fiables : prix, poids, stock)
  // Fallback sur product.variants si l'appel échoue
  let variantsToResolve: PfsVariantItem[] = product.variants ?? [];
  try {
    const variantResponse = await pfsGetVariants(product.id);
    if (variantResponse.data?.length > 0) {
      variantsToResolve = variantResponse.data;
      logger.info("[PFS Import] Using variants endpoint data", { reference, count: variantResponse.data.length });
    }
  } catch (err) {
    logger.warn("[PFS Import] Variants endpoint failed, using listProducts data", { reference, err: (err as Error).message });
  }

  // Images produit (fallback quand les images variante sont vides)
  const productImages = product.images ?? {};

  // Résolution variantes (couleurs + tailles)
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

  // Création du produit en statut SYNCING
  const createdProduct = await prisma.product.create({
    data: {
      reference,
      name,
      description,
      categoryId: category.id,
      status: "SYNCING",
      manufacturingCountryId,
      seasonId,
      compositions: {
        create: compositionsInput.map((c) => ({ compositionId: c.compositionId, percentage: c.percentage })),
      },
    },
    select: { id: true, reference: true, name: true },
  });

  // Récupère les noms de couleurs pour générer les SKU
  const colorNameMap = new Map<string, string>();
  const uniqueColorIds = Array.from(new Set(resolvedVariants.map((rv) => rv.colorId)));
  if (uniqueColorIds.length > 0) {
    const dbColors = await prisma.color.findMany({
      where: { id: { in: uniqueColorIds } },
      select: { id: true, name: true },
    });
    for (const c of dbColors) colorNameMap.set(c.id, c.name);
  }

  // Création des variantes
  const createdVariantIds: { id: string; colorId: string; pfsVariant: ResolvedVariant }[] = [];
  for (let i = 0; i < resolvedVariants.length; i++) {
    const rv = resolvedVariants[i];
    const colorName = colorNameMap.get(rv.colorId) ?? "COLOR";
    const variant = await prisma.productColor.create({
      data: {
        productId: createdProduct.id,
        colorId: rv.colorId,
        unitPrice: rv.unitPrice,
        weight: rv.weight,
        stock: rv.stock,
        isPrimary: i === 0,
        saleType: rv.saleType,
        packQuantity: rv.packQuantity,
        pfsColorRef: rv.pfsColorRef,
        sku: generateSku(reference, [colorName], rv.saleType, i + 1),
      },
      select: { id: true, colorId: true },
    });
    if (rv.sizeEntries.length > 0) {
      await prisma.variantSize.createMany({
        data: rv.sizeEntries.map((se) => ({
          productColorId: variant.id,
          sizeId: se.sizeId,
          quantity: se.quantity,
        })),
      });
    }
    createdVariantIds.push({ id: variant.id, colorId: rv.colorId, pfsVariant: rv });
  }

  logger.info("[PFS Import] Produit créé (SYNCING)", { productId: createdProduct.id, reference });

  emitProductEvent({
    type: "PRODUCT_CREATED",
    productId: createdProduct.id,
  });

  // Téléchargement des images (bloquant — supprime le produit si échec)
  try {
    await downloadImagesWithPlaywright(createdProduct.id, createdVariantIds);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("[PFS Import] Image download failed, deleting product", { productId: createdProduct.id, reference, err: errMsg });
    await cleanupFailedProduct(createdProduct.id);
    throw new Error(`Images introuvables pour ${reference} : ${errMsg}`);
  }

  return {
    productId: createdProduct.id,
    reference: createdProduct.reference,
    name: createdProduct.name,
    warnings,
  };
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

  // On utilise la première couleur comme couleur principale
  const primaryColor = await prisma.color.findFirst({
    where: { pfsColorRef: colorRef },
    select: { id: true },
  });
  if (!primaryColor) {
    throw new Error(`Couleur PFS "${colorRef}" non mappée`);
  }

  // Résolution des tailles
  const sizeRefs: { size: string; qty: number }[] = [];
  if (v.item?.size) {
    sizeRefs.push({ size: v.item.size, qty: 1 });
  }
  for (const pk of v.packs ?? []) {
    for (const sz of pk.sizes ?? []) {
      sizeRefs.push({ size: sz.size, qty: sz.qty });
    }
  }

  const sizeEntries: { sizeId: string; quantity: number }[] = [];
  for (const s of sizeRefs) {
    const size = await prisma.size.findFirst({
      where: { pfsSizeRef: s.size },
      select: { id: true },
    });
    if (size) sizeEntries.push({ sizeId: size.id, quantity: s.qty });
    else warnings.push(`Taille "${s.size}" non mappée (ignorée pour variante ${v.id})`);
  }

  // Images — d'abord celles de la variante
  const imageUrlsRaw: string[] = [];
  const variantImgs = v.images ?? {};
  for (const key of Object.keys(variantImgs)) {
    const val = variantImgs[key];
    if (Array.isArray(val)) imageUrlsRaw.push(...val);
    else if (val) imageUrlsRaw.push(val);
  }

  // Fallback : images du produit correspondant EXACTEMENT à cette couleur
  // Pas de fallback "DEFAUT" ni "première image" — sinon toutes les variantes
  // se retrouvent avec les mêmes photos
  if (imageUrlsRaw.length === 0 && Object.keys(productImages).length > 0) {
    // Cherche par référence couleur exacte (ex: "GOLDEN", "SILVER")
    const colorImgs = productImages[colorRef];
    if (colorImgs) {
      if (Array.isArray(colorImgs)) imageUrlsRaw.push(...colorImgs);
      else imageUrlsRaw.push(colorImgs);
    }
    // Cherche aussi par label couleur (parfois la clé est "Doré" au lieu de "GOLDEN")
    if (imageUrlsRaw.length === 0) {
      const colorLabel = colors[0]?.labels?.fr ?? colors[0]?.labels?.en;
      if (colorLabel) {
        const labelImgs = productImages[colorLabel];
        if (labelImgs) {
          if (Array.isArray(labelImgs)) imageUrlsRaw.push(...labelImgs);
          else imageUrlsRaw.push(labelImgs);
        }
      }
    }
  }

  // Dédoublonne les URLs (même image apparaissant sous plusieurs clés)
  const imageUrls = [...new Set(imageUrlsRaw)];

  return {
    colorId: primaryColor.id,
    unitPrice: v.price_sale?.total?.value ?? v.price_sale?.unit?.value ?? 0,
    weight: v.weight ?? 0,
    stock: v.stock_qty ?? 0,
    saleType: v.type === "PACK" ? "PACK" : "UNIT",
    packQuantity: v.type === "PACK" ? (v.pieces ?? 1) : null,
    pfsColorRef: colors.length > 1 ? colorRef : null,
    sizeEntries,
    imageUrls,
  };
}

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

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

interface PendingImage {
  variantId: string;
  colorId: string;
  url: string;
  order: number;
}

/**
 * Télécharge les images d'un produit en 2 passes :
 *   1) Navigateur A — parcourt toutes les images sans bloquer, met de côté les échecs
 *   2) Navigateur B (profil différent) — reprend les échecs, 3 essais max chacun
 * Si des images échouent après les 2 passes → erreur (le produit sera supprimé).
 */
async function downloadImagesWithPlaywright(
  productId: string,
  variants: { id: string; colorId: string; pfsVariant: ResolvedVariant }[],
): Promise<void> {
  const { chromium } = await import("playwright");

  // Construire la liste complète d'images à télécharger
  const allImages: PendingImage[] = [];
  for (const v of variants) {
    for (let idx = 0; idx < v.pfsVariant.imageUrls.length; idx++) {
      allImages.push({
        variantId: v.id,
        colorId: v.colorId,
        url: v.pfsVariant.imageUrls[idx],
        order: idx,
      });
    }
  }

  if (allImages.length === 0) {
    // Pas d'images → passe directement en IMPORTED
    await prisma.product.update({ where: { id: productId }, data: { status: "IMPORTED" } });
    emitProductEvent({ type: "PRODUCT_UPDATED", productId });
    return;
  }

  // ── Passe 1 : Navigateur A (Chrome/Windows) ──
  let failed: PendingImage[] = [];
  const browserA = await chromium.launch({ headless: true });
  try {
    const ctxA = await browserA.newContext(BROWSER_PROFILE_A);
    failed = await downloadImageBatch(ctxA, productId, allImages, "A");
    await ctxA.close();
  } finally {
    await browserA.close();
  }

  logger.info("[PFS Import] Pass A done", {
    productId,
    total: allImages.length,
    ok: allImages.length - failed.length,
    failed: failed.length,
  });

  // ── Passe 2 : Navigateur B (Safari/Mac) — reprend les échecs avec retries ──
  if (failed.length > 0) {
    const browserB = await chromium.launch({ headless: true });
    try {
      const ctxB = await browserB.newContext(BROWSER_PROFILE_B);
      let stillFailing = failed;

      for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS && stillFailing.length > 0; attempt++) {
        logger.info("[PFS Import] Pass B retry", {
          productId, attempt, remaining: stillFailing.length,
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
        stillFailing = await downloadImageBatch(ctxB, productId, stillFailing, "B");
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

  // Passe en statut IMPORTED une fois toutes les images OK
  await prisma.product.update({
    where: { id: productId },
    data: { status: "IMPORTED" },
  });

  emitProductEvent({ type: "PRODUCT_UPDATED", productId });
  logger.info("[PFS Import] Images téléchargées, produit en IMPORTED", { productId });
}

/**
 * Télécharge un lot d'images via un contexte Playwright.
 * Ne bloque jamais sur un échec — continue et renvoie la liste des échecs.
 */
async function downloadImageBatch(
  context: import("playwright").BrowserContext,
  productId: string,
  images: PendingImage[],
  passLabel: string,
): Promise<PendingImage[]> {
  const failed: PendingImage[] = [];

  for (const img of images) {
    try {
      const page = await context.newPage();
      try {
        const response = await page.goto(img.url, { waitUntil: "load", timeout: 30000 });
        if (!response || !response.ok()) {
          throw new Error(`HTTP ${response?.status() ?? "no response"}`);
        }
        const body = await response.body();
        if (!body || body.length === 0) throw new Error("Empty response body");

        // Traitement (conversion WebP 3 tailles + upload R2)
        const filename = `${Date.now()}_${img.variantId}_${img.order}`;
        const { dbPath } = await processProductImage(body, "public/uploads/products", filename);

        await prisma.productColorImage.create({
          data: {
            productId,
            colorId: img.colorId,
            productColorId: img.variantId,
            path: dbPath,
            order: img.order,
          },
        });

        logger.info(`[PFS Import] [${passLabel}] Image saved`, {
          productId, variant: img.variantId, order: img.order,
        });
      } finally {
        await page.close();
      }
    } catch (err) {
      logger.warn(`[PFS Import] [${passLabel}] Image failed`, {
        url: img.url, err: (err as Error).message,
      });
      failed.push(img);
    }
  }

  return failed;
}

/**
 * Supprime un produit et toutes ses données associées (variantes, images R2, tailles).
 * Utilisé quand le téléchargement des images échoue.
 */
async function cleanupFailedProduct(productId: string): Promise<void> {
  try {
    // Supprime les images déjà uploadées sur R2
    const images = await prisma.productColorImage.findMany({
      where: { productId },
      select: { path: true },
    });
    if (images.length > 0) {
      const r2Keys = images.flatMap(({ path }) => {
        const paths = getImagePaths(path);
        return [paths.large, paths.medium, paths.thumb].map(r2KeyFromDbPath);
      });
      await deleteMultipleFromR2(r2Keys).catch((err) => {
        logger.warn("[PFS Import] R2 cleanup partial failure", { productId, err: (err as Error).message });
      });
    }

    // Supprime le produit (cascade supprime variantes, tailles, images, compositions)
    await prisma.product.delete({ where: { id: productId } });
    logger.info("[PFS Import] Cleaned up failed product", { productId });
  } catch (err) {
    logger.error("[PFS Import] Cleanup failed", { productId, err: (err as Error).message });
  }
}
