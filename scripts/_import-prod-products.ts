import "dotenv/config";
/**
 * ONE-SHOT — À EXÉCUTER EN LOCAL.
 *
 * Wipe l'ensemble des produits + entités globales du tenant beliandjolie en
 * local, puis réimporte 20 produits copiés depuis la prod via le script
 * jumeau `_extract-prod-products.ts`. Utilise le JSON exporté à
 * `scripts/_products-20.json`.
 *
 * Préserve : ADMIN, CLIENT, SiteConfig, CompanyInfo, LegalDocument, Tenant,
 * TenantDomain. Delete uniquement Products + entités globales du tenant.
 *
 * Usage :
 *   npx tsx scripts/_import-prod-products.ts
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const JSON_PATH = path.resolve(process.cwd(), "scripts/_products-20.json");

interface Payload {
  tenantId: string;
  tenantSlug: string;
  productIds: string[];
  global: {
    categories: unknown[];
    subCategories: unknown[];
    colors: unknown[];
    sizes: unknown[];
    compositions: unknown[];
    seasons: unknown[];
    tags: unknown[];
    categoryTranslations: unknown[];
    subCategoryTranslations: unknown[];
    colorTranslations: unknown[];
    compositionTranslations: unknown[];
    seasonTranslations: unknown[];
    tagTranslations: unknown[];
  };
  products: {
    products: unknown[];
    productTranslations: unknown[];
    productColors: unknown[];
    productColorImages: unknown[];
    productCompositions: unknown[];
    productTags: unknown[];
    variantSizes: unknown[];
    packColorLines: unknown[];
    packColorLineSizes: unknown[];
  };
}

// Rehydrate les Date depuis strings ISO et Decimal depuis strings (Prisma
// sérialise en JSON les Decimal comme number, mais si le champ est trop
// précis on peut avoir besoin d'un cast — pour nos champs (prix,
// percentage) les number suffisent).
function rehydrateDates<T extends Record<string, unknown>>(rows: T[], keys: (keyof T)[]): T[] {
  return rows.map((r) => {
    const out = { ...r };
    for (const k of keys) {
      const v = out[k];
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        (out as Record<string, unknown>)[k as string] = new Date(v);
      }
    }
    return out;
  });
}

async function main() {
  const raw = await fs.readFile(JSON_PATH, "utf8");
  const payload = JSON.parse(raw) as Payload;
  console.log(`Import de ${payload.productIds.length} produits pour tenant ${payload.tenantSlug}`);

  const prisma = new PrismaClient();

  // ── 1. Wipe local : Products + relations directes ──────────────────────
  // On y va table par table pour éviter les erreurs de FK. Les tables
  // enfants (ProductColorImage, ProductComposition…) sont en onDelete Cascade
  // sur Product mais on préfère explicit pour tracer.
  console.log("Wipe local en cours…");
  const tenantId = payload.tenantId;

  // Skip tables métier (jamais présentes en dev normalement)
  const tenantWhere = { tenantId };
  const delCounts: Record<string, number> = {};
  delCounts.orderItemModif = (await prisma.orderItemModification.deleteMany({ where: tenantWhere })).count;
  delCounts.orderItem = (await prisma.orderItem.deleteMany({ where: tenantWhere })).count;
  delCounts.order = (await prisma.order.deleteMany({ where: tenantWhere })).count;
  delCounts.cartItem = (await prisma.cartItem.deleteMany({ where: tenantWhere })).count;
  delCounts.cart = (await prisma.cart.deleteMany({ where: tenantWhere })).count;
  delCounts.favorite = (await prisma.favorite.deleteMany({ where: tenantWhere })).count;
  delCounts.marketplaceRefreshJob = (await prisma.marketplaceRefreshJob.deleteMany({})).count;
  delCounts.imageProcessingJob = (await prisma.imageProcessingJob.deleteMany({ where: tenantWhere })).count;
  delCounts.microstoreUploadJob = (await prisma.microstoreUploadJob.deleteMany({ where: tenantWhere })).count;
  delCounts.stockMovement = (await prisma.stockMovement.deleteMany({ where: tenantWhere })).count;
  delCounts.productView = (await prisma.productView.deleteMany({ where: tenantWhere })).count;
  delCounts.priceHistory = (await prisma.priceHistory.deleteMany({ where: tenantWhere })).count;
  delCounts.pendingSimilar = (await prisma.pendingSimilar.deleteMany({ where: tenantWhere })).count;
  delCounts.productSimilar = (await prisma.productSimilar.deleteMany({ where: tenantWhere })).count;
  delCounts.productBundle = (await prisma.productBundle.deleteMany({ where: tenantWhere })).count;
  delCounts.collectionProduct = (await prisma.collectionProduct.deleteMany({ where: tenantWhere })).count;
  delCounts.catalogProduct = (await prisma.catalogProduct.deleteMany({ where: tenantWhere })).count;
  delCounts.promotionProduct = (await prisma.promotionProduct.deleteMany({ where: tenantWhere })).count;
  delCounts.promotionCategory = (await prisma.promotionCategory.deleteMany({ where: tenantWhere })).count;
  delCounts.promotionCollection = (await prisma.promotionCollection.deleteMany({ where: tenantWhere })).count;
  delCounts.promotionUsage = (await prisma.promotionUsage.deleteMany({ where: tenantWhere })).count;
  delCounts.promotion = (await prisma.promotion.deleteMany({ where: tenantWhere })).count;
  delCounts.efashionShootingBatchItem = (await prisma.efashionShootingBatchItem.deleteMany({ where: tenantWhere })).count;
  delCounts.packColorLineSize = (await prisma.packColorLineSize.deleteMany({ where: tenantWhere })).count;
  delCounts.packColorLine = (await prisma.packColorLine.deleteMany({ where: tenantWhere })).count;
  delCounts.variantSize = (await prisma.variantSize.deleteMany({ where: tenantWhere })).count;
  delCounts.productTag = (await prisma.productTag.deleteMany({ where: tenantWhere })).count;
  delCounts.productComposition = (await prisma.productComposition.deleteMany({ where: tenantWhere })).count;
  delCounts.productColorImage = (await prisma.productColorImage.deleteMany({ where: tenantWhere })).count;
  delCounts.productColor = (await prisma.productColor.deleteMany({ where: tenantWhere })).count;
  delCounts.productTranslation = (await prisma.productTranslation.deleteMany({ where: tenantWhere })).count;
  delCounts.pfsAuditResult = (await prisma.pfsAuditResult.deleteMany({ where: tenantWhere })).count;
  delCounts.pfsAuditRunChange = (await prisma.pfsAuditRunChange.deleteMany({ where: tenantWhere })).count;
  delCounts.pfsAuditRun = (await prisma.pfsAuditRun.deleteMany({ where: tenantWhere })).count;
  delCounts.product = (await prisma.product.deleteMany({ where: tenantWhere })).count;
  delCounts.collection = (await prisma.collection.deleteMany({ where: tenantWhere })).count;
  delCounts.collectionTranslation = (await prisma.collectionTranslation.deleteMany({ where: tenantWhere })).count;
  delCounts.catalog = (await prisma.catalog.deleteMany({ where: tenantWhere })).count;
  delCounts.tagTranslation = (await prisma.tagTranslation.deleteMany({})).count;
  delCounts.compositionTranslation = (await prisma.compositionTranslation.deleteMany({})).count;
  delCounts.seasonTranslation = (await prisma.seasonTranslation.deleteMany({})).count;
  delCounts.colorTranslation = (await prisma.colorTranslation.deleteMany({})).count;
  delCounts.subCategoryTranslation = (await prisma.subCategoryTranslation.deleteMany({})).count;
  delCounts.categoryTranslation = (await prisma.categoryTranslation.deleteMany({})).count;
  delCounts.tag = (await prisma.tag.deleteMany({ where: tenantWhere })).count;
  delCounts.composition = (await prisma.composition.deleteMany({ where: tenantWhere })).count;
  delCounts.season = (await prisma.season.deleteMany({ where: tenantWhere })).count;
  delCounts.size = (await prisma.size.deleteMany({ where: tenantWhere })).count;
  delCounts.color = (await prisma.color.deleteMany({ where: tenantWhere })).count;
  delCounts.subCategory = (await prisma.subCategory.deleteMany({ where: tenantWhere })).count;
  delCounts.category = (await prisma.category.deleteMany({ where: tenantWhere })).count;

  console.log("Wipe terminé :", delCounts);

  // ── 2. Insert des entités globales ─────────────────────────────────────
  console.log("Import des entités globales…");
  await prisma.category.createMany({
    data: rehydrateDates(payload.global.categories as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.subCategory.createMany({
    data: rehydrateDates(payload.global.subCategories as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.color.createMany({
    data: rehydrateDates(payload.global.colors as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.size.createMany({
    data: rehydrateDates(payload.global.sizes as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.composition.createMany({
    data: rehydrateDates(payload.global.compositions as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.season.createMany({
    data: rehydrateDates(payload.global.seasons as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.tag.createMany({
    data: rehydrateDates(payload.global.tags as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.categoryTranslation.createMany({
    data: rehydrateDates(payload.global.categoryTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.subCategoryTranslation.createMany({
    data: rehydrateDates(payload.global.subCategoryTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.colorTranslation.createMany({
    data: rehydrateDates(payload.global.colorTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.compositionTranslation.createMany({
    data: rehydrateDates(payload.global.compositionTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.seasonTranslation.createMany({
    data: rehydrateDates(payload.global.seasonTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.tagTranslation.createMany({
    data: rehydrateDates(payload.global.tagTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  console.log("Entités globales insérées.");

  // ── 3. Insert des produits + relations directes ────────────────────────
  // Nul-ifie hsCodeId : HsCode est une table globale (pas tenant-scoped) et
  // pas dumpée ; ce champ n'a pas d'impact sur les tests d'audit PFS.
  const rawProducts = payload.products.products as Record<string, unknown>[];
  for (const p of rawProducts) {
    p.hsCodeId = null;
  }
  console.log("Import des produits…");
  await prisma.product.createMany({
    data: rehydrateDates(rawProducts, [
      "createdAt",
      "updatedAt",
      "lastRefreshedAt",
      "pfsCheckedAt",
      "pfsLastRefreshedAt",
      "ankorsLastRefreshedAt",
      "efashionLastRefreshedAt",
      "faireLastRefreshedAt",
      "orderchampLastRefreshedAt",
      "orderchampLastPushedAt",
      "microstoreLastPushedAt",
      "microstoreLastRefreshedAt",
    ]) as never,
  });
  await prisma.productTranslation.createMany({
    data: rehydrateDates(payload.products.productTranslations as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.productColor.createMany({
    data: rehydrateDates(payload.products.productColors as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.productColorImage.createMany({
    data: rehydrateDates(payload.products.productColorImages as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.productComposition.createMany({
    data: rehydrateDates(payload.products.productCompositions as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.productTag.createMany({
    data: rehydrateDates(payload.products.productTags as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.variantSize.createMany({
    data: rehydrateDates(payload.products.variantSizes as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.packColorLine.createMany({
    data: rehydrateDates(payload.products.packColorLines as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  await prisma.packColorLineSize.createMany({
    data: rehydrateDates(payload.products.packColorLineSizes as Record<string, unknown>[], ["createdAt", "updatedAt"]) as never,
  });
  console.log("Produits + relations insérés.");

  // ── 4. Report final ────────────────────────────────────────────────────
  const nbProducts = await prisma.product.count({ where: tenantWhere });
  const nbColors = await prisma.productColor.count({ where: tenantWhere });
  const nbImages = await prisma.productColorImage.count({ where: tenantWhere });
  console.log(`\n✅ Import terminé : ${nbProducts} produits · ${nbColors} variantes · ${nbImages} images`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
