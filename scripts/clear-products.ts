/**
 * Clear all products + attributes (colors, categories, subcategories, compositions, tags)
 *
 * Usage: npx tsx scripts/clear-products.ts
 * or:    npm run clear:products
 *
 * Deletes in dependency order to avoid FK constraint violations.
 * Does NOT touch: users, orders, carts, collections, site config, etc.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🗑️  Suppression des produits + attributs...\n");

  // 1. Product-related (dependency order: children first)
  const restockAlerts = await prisma.restockAlert.deleteMany();
  console.log(`  RestockAlert        : ${restockAlerts.count}`);

  const favorites = await prisma.favorite.deleteMany();
  console.log(`  Favorite            : ${favorites.count}`);

  const cartItems = await prisma.cartItem.deleteMany();
  console.log(`  CartItem            : ${cartItems.count}`);

  const catalogProducts = await prisma.catalogProduct.deleteMany();
  console.log(`  CatalogProduct      : ${catalogProducts.count}`);

  const collectionProducts = await prisma.collectionProduct.deleteMany();
  console.log(`  CollectionProduct   : ${collectionProducts.count}`);

  const productColorImages = await prisma.productColorImage.deleteMany();
  console.log(`  ProductColorImage   : ${productColorImages.count}`);

  const productColorSubColors = await prisma.productColorSubColor.deleteMany();
  console.log(`  ProductColorSubColor: ${productColorSubColors.count}`);

  const productColors = await prisma.productColor.deleteMany();
  console.log(`  ProductColor        : ${productColors.count}`);

  const productSimilar = await prisma.productSimilar.deleteMany();
  console.log(`  ProductSimilar      : ${productSimilar.count}`);

  const pendingSimilar = await prisma.pendingSimilar.deleteMany();
  console.log(`  PendingSimilar      : ${pendingSimilar.count}`);

  const productTranslations = await prisma.productTranslation.deleteMany();
  console.log(`  ProductTranslation  : ${productTranslations.count}`);

  const productCompositions = await prisma.productComposition.deleteMany();
  console.log(`  ProductComposition  : ${productCompositions.count}`);

  const productTags = await prisma.productTag.deleteMany();
  console.log(`  ProductTag          : ${productTags.count}`);

  const products = await prisma.product.deleteMany();
  console.log(`  Product             : ${products.count}`);

  // 2. Import data
  const importDrafts = await prisma.importDraft.deleteMany();
  console.log(`  ImportDraft         : ${importDrafts.count}`);

  const importJobs = await prisma.importJob.deleteMany();
  console.log(`  ImportJob           : ${importJobs.count}`);

  // 3. Attributes
  const colorTranslations = await prisma.colorTranslation.deleteMany();
  console.log(`  ColorTranslation    : ${colorTranslations.count}`);

  const colors = await prisma.color.deleteMany();
  console.log(`  Color               : ${colors.count}`);

  const subCatTranslations = await prisma.subCategoryTranslation.deleteMany();
  console.log(`  SubCategoryTransl.  : ${subCatTranslations.count}`);

  const subCategories = await prisma.subCategory.deleteMany();
  console.log(`  SubCategory         : ${subCategories.count}`);

  const catTranslations = await prisma.categoryTranslation.deleteMany();
  console.log(`  CategoryTranslation : ${catTranslations.count}`);

  const categories = await prisma.category.deleteMany();
  console.log(`  Category            : ${categories.count}`);

  const compTranslations = await prisma.compositionTranslation.deleteMany();
  console.log(`  CompositionTransl.  : ${compTranslations.count}`);

  const compositions = await prisma.composition.deleteMany();
  console.log(`  Composition         : ${compositions.count}`);

  const tagTranslations = await prisma.tagTranslation.deleteMany();
  console.log(`  TagTranslation      : ${tagTranslations.count}`);

  const tags = await prisma.tag.deleteMany();
  console.log(`  Tag                 : ${tags.count}`);

  console.log("\n✅ Tout a été supprimé.");
}

main()
  .catch((err) => {
    console.error("❌ Erreur:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
