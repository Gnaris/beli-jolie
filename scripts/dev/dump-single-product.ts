/**
 * DUMP-SINGLE-PRODUCT
 *
 * A exécuter SUR LE VPS. Dump 1 produit du tenant `beliandjolie` avec :
 *  - toutes ses relations (colors, variantSizes, packLines, images…)
 *  - uniquement les référentiels UTILISÉS par ce produit
 *  - les SiteConfig microstore_picture_station_* (tels quels, chiffrés)
 *  - un tar des fichiers image du produit
 *
 * Usage sur VPS :
 *   cd /var/www/beliandjolie
 *   npx tsx scripts/dev/dump-single-product.ts A2630
 *
 * Sorties :
 *   /tmp/dump-<REF>.json
 *   /tmp/dump-<REF>-images.tar.gz
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const TENANT_SLUG = "beliandjolie";
const PROJECT_ROOT = "/var/www/beliandjolie";

const PRODUCT_INCLUDE = {
  colors: {
    include: {
      color: true,
      variantSizes: { include: { size: true } },
      packLines: {
        include: {
          color: true,
          sizes: { include: { size: true } },
        },
      },
      images: true,
    },
  },
  colorImages: true,
  compositions: { include: { composition: true } },
  tags: { include: { tag: true } },
  subCategories: true,
  translations: true,
  category: true,
  season: true,
  microstoreSubCategory: true,
  primaryColor: true,
  hsCode: true,
} as const;

async function main() {
  const reference = process.argv[2]?.trim();
  if (!reference) {
    console.error("Usage: npx tsx scripts/dev/dump-single-product.ts <REFERENCE>");
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);
  console.log(`[dump] Tenant: ${tenant.slug} (${tenant.id})`);

  const product = await prisma.product.findFirst({
    where: { reference, tenantId: tenant.id },
    include: PRODUCT_INCLUDE,
  });
  if (!product) throw new Error(`Produit ${reference} introuvable dans tenant ${TENANT_SLUG}`);
  console.log(`[dump] Produit trouvé: ${product.reference} (${product.id}) — ${product.name}`);

  // Collecte les IDs de référentiels utilisés par ce produit
  const usedCategoryIds = new Set<string>([product.categoryId]);
  const usedSubCategoryIds = new Set<string>(
    (product.subCategories ?? []).map((sc) => sc.id),
  );
  if (product.microstoreSubCategoryId) usedSubCategoryIds.add(product.microstoreSubCategoryId);
  const usedColorIds = new Set<string>();
  const usedSizeIds = new Set<string>();
  const usedCompositionIds = new Set<string>(
    (product.compositions ?? []).map((pc) => pc.compositionId),
  );
  const usedTagIds = new Set<string>((product.tags ?? []).map((pt) => pt.tagId));
  const usedSeasonIds = new Set<string>();
  const usedHsCodeIds = new Set<string>();
  if (product.seasonId) usedSeasonIds.add(product.seasonId);
  if (product.hsCodeId) usedHsCodeIds.add(product.hsCodeId);
  if (product.primaryColorId) usedColorIds.add(product.primaryColorId);
  for (const c of product.colors ?? []) {
    if (c.colorId) usedColorIds.add(c.colorId);
    for (const vs of c.variantSizes ?? []) usedSizeIds.add(vs.sizeId);
    for (const pl of c.packLines ?? []) {
      if (pl.colorId) usedColorIds.add(pl.colorId);
      for (const s of pl.sizes ?? []) usedSizeIds.add(s.sizeId);
    }
  }
  for (const img of product.colorImages ?? []) {
    if (img.colorId) usedColorIds.add(img.colorId);
  }

  const [categories, subCategories, colors, sizes, compositions, tags, seasons, hsCodes] =
    await Promise.all([
      prisma.category.findMany({
        where: { id: { in: Array.from(usedCategoryIds) } },
        include: { translations: true },
      }),
      prisma.subCategory.findMany({
        where: { id: { in: Array.from(usedSubCategoryIds) } },
        include: { translations: true },
      }),
      prisma.color.findMany({
        where: { id: { in: Array.from(usedColorIds) } },
        include: { translations: true },
      }),
      prisma.size.findMany({ where: { id: { in: Array.from(usedSizeIds) } } }),
      prisma.composition.findMany({
        where: { id: { in: Array.from(usedCompositionIds) } },
        include: { translations: true },
      }),
      prisma.tag.findMany({
        where: { id: { in: Array.from(usedTagIds) } },
        include: { translations: true },
      }),
      prisma.season.findMany({
        where: { id: { in: Array.from(usedSeasonIds) } },
        include: { translations: true },
      }),
      prisma.hsCode.findMany({ where: { id: { in: Array.from(usedHsCodeIds) } } }),
    ]);

  // SiteConfig microstore_picture_station_* (chiffrés — l'import local
  // suppose la même ENCRYPTION_KEY, à vérifier hors script).
  const siteConfigs = await prisma.siteConfig.findMany({
    where: {
      tenantId: tenant.id,
      key: { in: [
        "microstore_picture_station_key",
        "microstore_picture_station_expires_at",
        "microstore_picture_station_short_url",
      ] },
    },
  });

  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      tenantIdSource: tenant.id,
      tenantSlugSource: TENANT_SLUG,
      reference,
    },
    referentials: {
      categories, subCategories, colors, sizes, compositions, tags, seasons, hsCodes,
    },
    siteConfigs,
    product,
  };

  const OUT_JSON = `/tmp/dump-${reference}.json`;
  const OUT_TAR = `/tmp/dump-${reference}-images.tar.gz`;
  const jsonText = JSON.stringify(
    payload,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  await fs.writeFile(OUT_JSON, jsonText, "utf8");
  console.log(`[dump] JSON: ${OUT_JSON} (${(jsonText.length / 1024).toFixed(0)} Ko)`);

  // Dossier images : convention `public/uploads/<tenant>/produits/<ref-lowercase>/`.
  const productDirRel = path.posix.join(
    "public/uploads",
    TENANT_SLUG,
    "produits",
    reference.toLowerCase(),
  );
  const productDirAbs = path.join(PROJECT_ROOT, productDirRel);
  const exists = await fs.stat(productDirAbs).then(() => true).catch(() => false);
  if (exists) {
    console.log(`[dump] tar ${productDirRel}...`);
    await runFile("tar", [
      "-czf", OUT_TAR, "-C", PROJECT_ROOT, productDirRel,
    ]);
    const stat = await fs.stat(OUT_TAR);
    console.log(`[dump] Tar: ${OUT_TAR} (${(stat.size / 1024).toFixed(0)} Ko)`);
  } else {
    console.warn(`[dump] Dossier images introuvable: ${productDirAbs} — tar vide`);
    await runFile("tar", ["-czf", OUT_TAR, "-T", "/dev/null"]);
  }

  console.log(`[dump] Récap:`);
  console.log(`  colors: ${product.colors.length}`);
  console.log(`  colorImages: ${product.colorImages.length}`);
  console.log(`  categories: ${categories.length}, subCat: ${subCategories.length}, colors: ${colors.length}`);
  console.log(`  sizes: ${sizes.length}, comp: ${compositions.length}, tags: ${tags.length}`);
  console.log(`  seasons: ${seasons.length}, hsCodes: ${hsCodes.length}, siteConfigs: ${siteConfigs.length}`);
  console.log(`[dump] OK`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[dump] ERREUR", err);
  process.exit(1);
});
