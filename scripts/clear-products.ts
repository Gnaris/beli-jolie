/**
 * Clear all products + attributes (colors, categories, subcategories, compositions, tags, seasons, manufacturing countries, sizes)
 *
 * Usage: npx tsx scripts/clear-products.ts
 * or:    npm run clear:products
 *
 * Deletes in dependency order to avoid FK constraint violations.
 * Does NOT touch: users, orders, carts, collections, site config, etc.
 */

import { PrismaClient } from "@prisma/client";
import { listFiles, deleteFiles } from "../lib/storage";

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

  const variantSizes = await prisma.variantSize.deleteMany();
  console.log(`  VariantSize         : ${variantSizes.count}`);

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

  // 4. Seasons & Manufacturing Countries
  const seasonTranslations = await prisma.seasonTranslation.deleteMany();
  console.log(`  SeasonTranslation   : ${seasonTranslations.count}`);

  const seasons = await prisma.season.deleteMany();
  console.log(`  Season              : ${seasons.count}`);

  const countryTranslations = await prisma.manufacturingCountryTranslation.deleteMany();
  console.log(`  CountryTranslation  : ${countryTranslations.count}`);

  const countries = await prisma.manufacturingCountry.deleteMany();
  console.log(`  ManufacturingCountry: ${countries.count}`);

  // 5. Sizes
  const sizes = await prisma.size.deleteMany();
  console.log(`  Size                : ${sizes.count}`);

  // 6. Supprimer les images locales
  console.log("\n🗂️  Suppression des images du stockage local...");

  const prefixes = [
    "uploads/products/",          // images produit (large, _md, _thumb)
    "uploads/patterns/",          // patterns couleurs (upload-pattern)
  ];
  for (const prefix of prefixes) {
    try {
      const keys = await listFiles(prefix);
      if (keys.length > 0) {
        await deleteFiles(keys);
      }
      console.log(`  ${prefix}: ${keys.length} fichier(s) supprimé(s)`);
    } catch (err) {
      console.warn(`  ⚠️ Erreur stockage pour ${prefix}:`, err);
    }
  }

  console.log("\n✅ Tout a été supprimé.");

  // Revalidate Next.js cache so sidebar warnings update immediately
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const secret = process.env.NEXTAUTH_SECRET;
  if (secret) {
    try {
      const res = await fetch(`${baseUrl}/api/admin/revalidate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret,
          tags: ["products", "categories", "colors", "tags", "compositions"],
        }),
      });
      if (res.ok) {
        console.log("🔄 Cache Next.js revalidé.");
      } else {
        console.warn("⚠️  Revalidation échouée (serveur non démarré ?):", res.status);
      }
    } catch {
      console.warn("⚠️  Impossible de revalider le cache (serveur non démarré ?).");
    }
  }
}

main()
  .catch((err) => {
    console.error("❌ Erreur:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
