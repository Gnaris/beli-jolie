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
  type PfsProduct,
  type PfsVariantItem,
  type PfsColorInfo,
} from "@/lib/pfs-api";
import { processProductImage } from "@/lib/image-processor";
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
const DEEP_SCAN_SAMPLE_SIZE = 50; // nb de produits à inspecter en profondeur (checkReference) pour composition / pays / saison

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

// ─────────────────────────────────────────────
// 1 — Collecte des attributs utilisés
// ─────────────────────────────────────────────

/**
 * Parcourt TOUTES les pages listProducts puis un échantillon checkReference
 * pour extraire les attributs uniques (catégorie, famille, couleurs, tailles,
 * composition, pays, saison).
 */
export async function scanPfsAttributes(options?: {
  maxPages?: number;
  deepSampleSize?: number;
}): Promise<PfsAttributeScan> {
  const maxPages = options?.maxPages ?? 50;
  const deepSampleSize = options?.deepSampleSize ?? DEEP_SCAN_SAMPLE_SIZE;

  const products: PfsProduct[] = [];

  // Page 1 — récupère également meta pour savoir combien de pages au total
  const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE);
  products.push(...first.data);
  const totalPages = Math.min(first.meta?.last_page ?? 1, maxPages);

  for (let p = 2; p <= totalPages; p++) {
    const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE);
    products.push(...pageData.data);
    if (pageData.data.length === 0) break;
  }

  // Collecte des attributs "peu coûteux" (visibles dans listProducts)
  const rawCategories: { pfsRef: string; label: string }[] = [];
  const rawColors: { pfsRef: string; label: string }[] = [];
  const rawSizes: { pfsRef: string; label: string }[] = [];

  for (const prod of products) {
    // catégorie = family (ex: "Bagues") — c'est ce qui correspond à notre Category
    if (prod.family) {
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

  // Échantillon profond (checkReference) pour compositions / pays / saisons
  const rawCompositions: { pfsRef: string; label: string }[] = [];
  const rawCountries: { pfsRef: string; label: string }[] = [];
  const rawSeasons: { pfsRef: string; label: string }[] = [];

  const sample = products.slice(0, deepSampleSize);
  for (const prod of sample) {
    try {
      const ref = await pfsCheckReference(prod.reference);
      const detail = ref.product;
      if (!detail) continue;

      for (const mat of detail.material_composition ?? []) {
        const label = mat.labels?.fr ?? mat.labels?.en ?? mat.reference;
        rawCompositions.push({ pfsRef: mat.reference, label });
      }

      if (detail.country_of_manufacture) {
        rawCountries.push({
          pfsRef: detail.country_of_manufacture,
          label: detail.country_of_manufacture,
        });
      }

      if (detail.collection?.reference) {
        const seasonLabel = detail.collection.labels?.fr ?? detail.collection.labels?.en ?? detail.collection.reference;
        rawSeasons.push({ pfsRef: detail.collection.reference, label: seasonLabel });
      }
    } catch (err) {
      logger.warn("[PFS Import] scanAttributes checkReference failed", { ref: prod.reference, err: (err as Error).message });
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
      where: { pfsFamilyName: { in: categories.map((c) => c.pfsRef) } },
      select: { id: true, name: true, pfsFamilyName: true },
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

  const catMap = new Map(localCategories.map((c) => [c.pfsFamilyName!, c]));
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
          data: { pfsFamilyName: pfsRef, pfsCategoryName: pfsRef },
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
        data: { name: label, slug, pfsFamilyName: pfsRef, pfsCategoryName: pfsRef },
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

export async function listImportablePfsProducts(options?: { maxPages?: number }): Promise<ImportablePfsProduct[]> {
  const maxPages = options?.maxPages ?? 50;

  const all: PfsProduct[] = [];
  const first = await pfsListProducts(1, PFS_LIST_PAGE_SIZE);
  all.push(...first.data);
  const totalPages = Math.min(first.meta?.last_page ?? 1, maxPages);
  for (let p = 2; p <= totalPages; p++) {
    const pageData = await pfsListProducts(p, PFS_LIST_PAGE_SIZE);
    all.push(...pageData.data);
    if (pageData.data.length === 0) break;
  }

  // Références déjà présentes chez nous
  const references = all.map((p) => p.reference.trim().toUpperCase());
  const existing = await prisma.product.findMany({
    where: { reference: { in: references } },
    select: { reference: true },
  });
  const existingRefs = new Set(existing.map((e) => e.reference));

  return all
    .filter((p) => !existingRefs.has(p.reference.trim().toUpperCase()))
    .map((p) => ({
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

  // Résolution catégorie
  const category = await prisma.category.findFirst({
    where: { pfsFamilyName: product.family },
    select: { id: true, name: true },
  });
  if (!category) {
    throw new Error(`Catégorie non mappée pour la famille PFS "${product.family}". Créez d'abord la correspondance.`);
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

  // Résolution variantes (couleurs + tailles)
  const resolvedVariants: ResolvedVariant[] = [];
  for (const v of product.variants ?? []) {
    try {
      const rv = await resolveVariant(v, warnings);
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
        stock: 0,
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

  // Téléchargement des images en arrière-plan (fire-and-forget)
  downloadImagesBackground(createdProduct.id, createdVariantIds).catch((err) => {
    logger.error("[PFS Import] Background image download failed", { productId: createdProduct.id, err: (err as Error).message });
  });

  return {
    productId: createdProduct.id,
    reference: createdProduct.reference,
    name: createdProduct.name,
    warnings,
  };
}

async function resolveVariant(v: PfsVariantItem, warnings: string[]): Promise<ResolvedVariant | null> {
  const colors: PfsColorInfo[] = v.item
    ? [v.item.color]
    : (v.packs ?? []).map((pk) => pk.color);
  if (colors.length === 0 || !colors[0]?.reference) return null;

  // On utilise la première couleur comme couleur principale
  const primaryColor = await prisma.color.findFirst({
    where: { pfsColorRef: colors[0].reference },
    select: { id: true },
  });
  if (!primaryColor) {
    throw new Error(`Couleur PFS "${colors[0].reference}" non mappée`);
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

  // Images — récupère tout ce qui pointe vers cette couleur
  const imageUrls: string[] = [];
  const imgs = v.images ?? {};
  for (const key of Object.keys(imgs)) {
    const val = imgs[key];
    if (Array.isArray(val)) imageUrls.push(...val);
    else if (val) imageUrls.push(val);
  }

  return {
    colorId: primaryColor.id,
    unitPrice: v.price_sale?.total?.value ?? v.price_sale?.unit?.value ?? 0,
    weight: v.weight ?? 0,
    saleType: v.type === "PACK" ? "PACK" : "UNIT",
    packQuantity: v.type === "PACK" ? (v.pieces ?? 1) : null,
    pfsColorRef: colors.length > 1 ? colors[0].reference : null,
    sizeEntries,
    imageUrls,
  };
}

async function downloadImagesBackground(
  productId: string,
  variants: { id: string; colorId: string; pfsVariant: ResolvedVariant }[],
): Promise<void> {
  for (const v of variants) {
    for (let idx = 0; idx < v.pfsVariant.imageUrls.length; idx++) {
      const url = v.pfsVariant.imageUrls[idx];
      try {
        const response = await fetch(url);
        if (!response.ok) {
          logger.warn("[PFS Import] Image fetch failed", { url, status: response.status });
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const filename = `${Date.now()}_${v.id}_${idx}`;
        const { dbPath } = await processProductImage(buffer, "public/uploads/products", filename);

        await prisma.productColorImage.create({
          data: {
            productId,
            colorId: v.colorId,
            productColorId: v.id,
            path: dbPath,
            order: idx,
          },
        });
      } catch (err) {
        logger.warn("[PFS Import] Image processing failed", { url, err: (err as Error).message });
      }
    }
  }

  // Passe en statut IMPORTED une fois toutes les images tentées
  await prisma.product.update({
    where: { id: productId },
    data: { status: "IMPORTED" },
  });

  emitProductEvent({
    type: "PRODUCT_UPDATED",
    productId,
  });

  logger.info("[PFS Import] Images téléchargées, produit en IMPORTED", { productId });
}
