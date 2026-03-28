/**
 * Clear la base de données entièrement.
 * Usage : npx tsx scripts/clear-database.ts
 *
 * Supprime TOUTES les tables dans l'ordre des dépendances (FK).
 * Demande confirmation avant d'exécuter.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  console.log("\n========================================");
  console.log("   SUPPRESSION TOTALE DE LA BASE");
  console.log("========================================\n");
  console.log("Cette operation va supprimer TOUTES les donnees :");
  console.log("  - Utilisateurs, commandes, paniers");
  console.log("  - Produits, variantes, images");
  console.log("  - Categories, couleurs, compositions");
  console.log("  - Collections, catalogues, codes d'acces");
  console.log("  - Configuration du site, emails envoyes");
  console.log("  - Jobs d'import/sync PFS");
  console.log("  - Tout le reste\n");

  const answer = await ask("Tapez 'SUPPRIMER' pour confirmer : ");
  if (answer !== "supprimer") {
    console.log("Annule.\n");
    return;
  }

  console.log("\nSuppression en cours...\n");

  // Ordre de suppression : enfants → parents (respect des FK)

  // ── Restock alerts, favorites, cart items ──
  const restockAlerts = await prisma.restockAlert.deleteMany();
  console.log(`  RestockAlert                   : ${restockAlerts.count}`);

  const favorites = await prisma.favorite.deleteMany();
  console.log(`  Favorite                       : ${favorites.count}`);

  const cartItems = await prisma.cartItem.deleteMany();
  console.log(`  CartItem                       : ${cartItems.count}`);

  const carts = await prisma.cart.deleteMany();
  console.log(`  Cart                           : ${carts.count}`);

  // ── Orders ──
  const orderItems = await prisma.orderItem.deleteMany();
  console.log(`  OrderItem                      : ${orderItems.count}`);

  const orders = await prisma.order.deleteMany();
  console.log(`  Order                          : ${orders.count}`);

  const shippingAddresses = await prisma.shippingAddress.deleteMany();
  console.log(`  ShippingAddress                : ${shippingAddresses.count}`);

  // ── Collections ──
  const collectionProducts = await prisma.collectionProduct.deleteMany();
  console.log(`  CollectionProduct              : ${collectionProducts.count}`);

  const collectionTranslations = await prisma.collectionTranslation.deleteMany();
  console.log(`  CollectionTranslation          : ${collectionTranslations.count}`);

  const collections = await prisma.collection.deleteMany();
  console.log(`  Collection                     : ${collections.count}`);

  // ── Catalogs ──
  const catalogProducts = await prisma.catalogProduct.deleteMany();
  console.log(`  CatalogProduct                 : ${catalogProducts.count}`);

  const catalogs = await prisma.catalog.deleteMany();
  console.log(`  Catalog                        : ${catalogs.count}`);

  // ── Access codes ──
  const accessCodeViews = await prisma.accessCodeView.deleteMany();
  console.log(`  AccessCodeView                 : ${accessCodeViews.count}`);

  const accessCodes = await prisma.accessCode.deleteMany();
  console.log(`  AccessCode                     : ${accessCodes.count}`);

  // ── Product images, sub-colors, variant sizes, pack lines ──
  const productColorImages = await prisma.productColorImage.deleteMany();
  console.log(`  ProductColorImage              : ${productColorImages.count}`);

  const productColorSubColors = await prisma.productColorSubColor.deleteMany();
  console.log(`  ProductColorSubColor           : ${productColorSubColors.count}`);

  const variantSizes = await prisma.variantSize.deleteMany();
  console.log(`  VariantSize                    : ${variantSizes.count}`);

  const packColorLineColors = await prisma.packColorLineColor.deleteMany();
  console.log(`  PackColorLineColor             : ${packColorLineColors.count}`);

  const packColorLines = await prisma.packColorLine.deleteMany();
  console.log(`  PackColorLine                  : ${packColorLines.count}`);

  // ── Product colors, similars, translations, compositions, tags ──
  const productColors = await prisma.productColor.deleteMany();
  console.log(`  ProductColor                   : ${productColors.count}`);

  const productSimilar = await prisma.productSimilar.deleteMany();
  console.log(`  ProductSimilar                 : ${productSimilar.count}`);

  const pendingSimilar = await prisma.pendingSimilar.deleteMany();
  console.log(`  PendingSimilar                 : ${pendingSimilar.count}`);

  const productTranslations = await prisma.productTranslation.deleteMany();
  console.log(`  ProductTranslation             : ${productTranslations.count}`);

  const productCompositions = await prisma.productComposition.deleteMany();
  console.log(`  ProductComposition             : ${productCompositions.count}`);

  const productTags = await prisma.productTag.deleteMany();
  console.log(`  ProductTag                     : ${productTags.count}`);

  const products = await prisma.product.deleteMany();
  console.log(`  Product                        : ${products.count}`);

  // ── Import / PFS sync ──
  const importDrafts = await prisma.importDraft.deleteMany();
  console.log(`  ImportDraft                    : ${importDrafts.count}`);

  const importJobs = await prisma.importJob.deleteMany();
  console.log(`  ImportJob                      : ${importJobs.count}`);

  const pfsStagedProducts = await prisma.pfsStagedProduct.deleteMany();
  console.log(`  PfsStagedProduct               : ${pfsStagedProducts.count}`);

  const pfsPrepareJobs = await prisma.pfsPrepareJob.deleteMany();
  console.log(`  PfsPrepareJob                  : ${pfsPrepareJobs.count}`);

  const pfsSyncJobs = await prisma.pfsSyncJob.deleteMany();
  console.log(`  PfsSyncJob                     : ${pfsSyncJobs.count}`);

  const pfsMappings = await prisma.pfsMapping.deleteMany();
  console.log(`  PfsMapping                     : ${pfsMappings.count}`);

  // ── Attributes ──
  const colorTranslations = await prisma.colorTranslation.deleteMany();
  console.log(`  ColorTranslation               : ${colorTranslations.count}`);

  const colors = await prisma.color.deleteMany();
  console.log(`  Color                          : ${colors.count}`);

  const subCategoryTranslations = await prisma.subCategoryTranslation.deleteMany();
  console.log(`  SubCategoryTranslation         : ${subCategoryTranslations.count}`);

  const subCategories = await prisma.subCategory.deleteMany();
  console.log(`  SubCategory                    : ${subCategories.count}`);

  const categoryTranslations = await prisma.categoryTranslation.deleteMany();
  console.log(`  CategoryTranslation            : ${categoryTranslations.count}`);

  const categories = await prisma.category.deleteMany();
  console.log(`  Category                       : ${categories.count}`);

  const compositionTranslations = await prisma.compositionTranslation.deleteMany();
  console.log(`  CompositionTranslation         : ${compositionTranslations.count}`);

  const compositions = await prisma.composition.deleteMany();
  console.log(`  Composition                    : ${compositions.count}`);

  const tagTranslations = await prisma.tagTranslation.deleteMany();
  console.log(`  TagTranslation                 : ${tagTranslations.count}`);

  const tags = await prisma.tag.deleteMany();
  console.log(`  Tag                            : ${tags.count}`);

  const seasonTranslations = await prisma.seasonTranslation.deleteMany();
  console.log(`  SeasonTranslation              : ${seasonTranslations.count}`);

  const seasonPfsRefs = await prisma.seasonPfsRef.deleteMany();
  console.log(`  SeasonPfsRef                   : ${seasonPfsRefs.count}`);

  const seasons = await prisma.season.deleteMany();
  console.log(`  Season                         : ${seasons.count}`);

  const countryTranslations = await prisma.manufacturingCountryTranslation.deleteMany();
  console.log(`  ManufacturingCountryTranslation: ${countryTranslations.count}`);

  const countries = await prisma.manufacturingCountry.deleteMany();
  console.log(`  ManufacturingCountry           : ${countries.count}`);

  // ── Sizes ──
  const sizePfsMappings = await prisma.sizePfsMapping.deleteMany();
  console.log(`  SizePfsMapping                 : ${sizePfsMappings.count}`);

  const sizeCategoryLinks = await prisma.sizeCategoryLink.deleteMany();
  console.log(`  SizeCategoryLink               : ${sizeCategoryLinks.count}`);

  const sizes = await prisma.size.deleteMany();
  console.log(`  Size                           : ${sizes.count}`);

  // ── Legal ──
  const legalDocumentVersions = await prisma.legalDocumentVersion.deleteMany();
  console.log(`  LegalDocumentVersion           : ${legalDocumentVersions.count}`);

  const legalDocuments = await prisma.legalDocument.deleteMany();
  console.log(`  LegalDocument                  : ${legalDocuments.count}`);

  // ── Company info ──
  const companyInfos = await prisma.companyInfo.deleteMany();
  console.log(`  CompanyInfo                    : ${companyInfos.count}`);

  // ── Emails ──
  const sentEmails = await prisma.sentEmail.deleteMany();
  console.log(`  SentEmail                      : ${sentEmails.count}`);

  // ── Translation quotas ──
  const translationQuotas = await prisma.translationQuota.deleteMany();
  console.log(`  TranslationQuota               : ${translationQuotas.count}`);

  // ── Site config ──
  const siteConfig = await prisma.siteConfig.deleteMany();
  console.log(`  SiteConfig                     : ${siteConfig.count}`);

  // ── Auth / security ──
  const passwordResetTokens = await prisma.passwordResetToken.deleteMany();
  console.log(`  PasswordResetToken             : ${passwordResetTokens.count}`);

  const loginAttempts = await prisma.loginAttempt.deleteMany();
  console.log(`  LoginAttempt                   : ${loginAttempts.count}`);

  const accountLockouts = await prisma.accountLockout.deleteMany();
  console.log(`  AccountLockout                 : ${accountLockouts.count}`);

  const registrationLogs = await prisma.registrationLog.deleteMany();
  console.log(`  RegistrationLog                : ${registrationLogs.count}`);

  const userActivities = await prisma.userActivity.deleteMany();
  console.log(`  UserActivity                   : ${userActivities.count}`);

  // ── Users (en dernier) ──
  const users = await prisma.user.deleteMany();
  console.log(`  User                           : ${users.count}`);

  console.log("\n========================================");
  console.log("   Base de donnees videe avec succes");
  console.log("========================================\n");
  console.log("Lancez 'npx tsx scripts/create-admin.ts' pour recreer un compte admin.\n");
}

main()
  .catch((e) => {
    console.error("Erreur :", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
