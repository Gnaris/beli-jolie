import "dotenv/config";
/**
 * ONE-SHOT — À EXÉCUTER SUR LE VPS PROD.
 *
 * Extrait 20 produits de beliandjolie qui sont liés à TOUTES les marketplaces
 * (PFS + Ankor + eFashion + Faire + Orderchamp + Microstore) + toutes leurs
 * relations directes + toutes les entités globales du tenant (Category,
 * SubCategory, Color, Size, Composition, Season, ManufacturingCountry, Tag)
 * dans un unique JSON /tmp/products-20.json.
 *
 * Usage :
 *   cd /var/www/beliandjolie && npx tsx scripts/_extract-prod-products.ts
 */
import { PrismaClient } from "@prisma/client";

const TENANT_SLUG = "beliandjolie";
const NB_PRODUCTS = 20;
const OUTPUT_PATH = "/tmp/products-20.json";

async function main() {
  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} introuvable`);
  console.log(`Tenant ${tenant.slug} → ${tenant.id}`);

  const candidateIdsRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT p.id
     FROM Product p
     WHERE p.tenantId = ?
       AND p.pfsProductId IS NOT NULL
       AND p.ankorsProductId IS NOT NULL
       AND p.faireProductId IS NOT NULL
       AND p.orderchampProductId IS NOT NULL
       AND p.microstoreProductId IS NOT NULL
       AND EXISTS (SELECT 1 FROM ProductColor pc WHERE pc.productId = p.id AND pc.efashionProductId IS NOT NULL)
     ORDER BY p.createdAt DESC
     LIMIT ?`,
    tenant.id,
    NB_PRODUCTS,
  );
  const productIds = candidateIdsRows.map((r) => r.id);
  console.log(`Produits sélectionnés : ${productIds.length}`);
  if (productIds.length < NB_PRODUCTS) {
    console.warn(`⚠️  Seulement ${productIds.length} produits éligibles (attendu ${NB_PRODUCTS}).`);
  }

  // ── Entités globales du tenant ─────────────────────────────────────────
  const categories = await prisma.category.findMany({ where: { tenantId: tenant.id } });
  const subCategories = await prisma.subCategory.findMany({ where: { tenantId: tenant.id } });
  const colors = await prisma.color.findMany({ where: { tenantId: tenant.id } });
  const sizes = await prisma.size.findMany({ where: { tenantId: tenant.id } });
  const compositions = await prisma.composition.findMany({ where: { tenantId: tenant.id } });
  const seasons = await prisma.season.findMany({ where: { tenantId: tenant.id } });
  const tags = await prisma.tag.findMany({ where: { tenantId: tenant.id } });

  // Traductions des entités globales
  const categoryTranslations = await prisma.categoryTranslation.findMany({
    where: { categoryId: { in: categories.map((c) => c.id) } },
  });
  const subCategoryTranslations = await prisma.subCategoryTranslation.findMany({
    where: { subCategoryId: { in: subCategories.map((c) => c.id) } },
  });
  const colorTranslations = await prisma.colorTranslation.findMany({
    where: { colorId: { in: colors.map((c) => c.id) } },
  });
  // Pas de SizeTranslation dans le schéma — sizes sont des chaînes universelles.
  const compositionTranslations = await prisma.compositionTranslation.findMany({
    where: { compositionId: { in: compositions.map((c) => c.id) } },
  });
  const seasonTranslations = await prisma.seasonTranslation.findMany({
    where: { seasonId: { in: seasons.map((s) => s.id) } },
  });
  const tagTranslations = await prisma.tagTranslation.findMany({
    where: { tagId: { in: tags.map((t) => t.id) } },
  });

  // ── Produits + relations directes ──────────────────────────────────────
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    orderBy: { createdAt: "desc" },
  });
  const productTranslations = await prisma.productTranslation.findMany({
    where: { productId: { in: productIds } },
  });
  const productColors = await prisma.productColor.findMany({
    where: { productId: { in: productIds } },
  });
  const colorIds = productColors.map((c) => c.id);
  const productColorImages = await prisma.productColorImage.findMany({
    where: { productId: { in: productIds } },
  });
  const productCompositions = await prisma.productComposition.findMany({
    where: { productId: { in: productIds } },
  });
  const productTags = await prisma.productTag.findMany({
    where: { productId: { in: productIds } },
  });
  const variantSizes = await prisma.variantSize.findMany({
    where: { productColorId: { in: colorIds } },
  });
  const packColorLines = await prisma.packColorLine.findMany({
    where: { productColorId: { in: colorIds } },
  });
  const packColorLineIds = packColorLines.map((l) => l.id);
  const packColorLineSizes = await prisma.packColorLineSize.findMany({
    where: { packColorLineId: { in: packColorLineIds } },
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    productIds,
    global: {
      categories,
      subCategories,
      colors,
      sizes,
      compositions,
      seasons,
      tags,
      categoryTranslations,
      subCategoryTranslations,
      colorTranslations,
      compositionTranslations,
      seasonTranslations,
      tagTranslations,
    },
    products: {
      products,
      productTranslations,
      productColors,
      productColorImages,
      productCompositions,
      productTags,
      variantSizes,
      packColorLines,
      packColorLineSizes,
    },
  };

  const fs = await import("node:fs/promises");
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`✅ JSON écrit : ${OUTPUT_PATH}`);
  console.log(`   products=${products.length}, colors=${productColors.length}, images=${productColorImages.length}, compos=${productCompositions.length}`);
  console.log(`   variantSizes=${variantSizes.length}, packLines=${packColorLines.length}, packSizes=${packColorLineSizes.length}`);
  console.log(`   globals: cat=${categories.length}, sub=${subCategories.length}, color=${colors.length}, size=${sizes.length}, compo=${compositions.length}, season=${seasons.length}, tag=${tags.length}`);

  // Aussi produire la liste des `reference` pour le rsync images.
  const refs = products.map((p) => p.reference);
  await fs.writeFile("/tmp/products-20-refs.txt", refs.join("\n"));
  console.log(`   refs → /tmp/products-20-refs.txt (${refs.length} lignes)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
