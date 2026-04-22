/**
 * Clear la base de données SAUF les comptes utilisateurs (admin + client).
 * Usage : npx tsx scripts/clear-database-keep-users.ts
 *
 * Supprime toutes les tables dans l'ordre des dépendances (FK)
 * mais conserve la table User intacte.
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
  const userCount = await prisma.user.count();

  console.log("\n========================================");
  console.log("   NETTOYAGE BASE (comptes conserves)");
  console.log("========================================\n");
  console.log(`${userCount} compte(s) utilisateur seront conserves.`);
  console.log("Tout le reste sera supprime :");
  console.log("  - Produits, variantes, images");
  console.log("  - Commandes, paniers, favoris");
  console.log("  - Categories, couleurs, tailles, compositions");
  console.log("  - Collections, catalogues, codes d'acces");
  console.log("  - Promotions, avoirs, reclamations");
  console.log("  - Messagerie, alertes, historique");
  console.log("  - Configuration du site, documents legaux");
  console.log("  - Jobs d'import, logs de securite\n");

  const answer = await ask("Tapez 'VIDER' pour confirmer : ");
  if (answer !== "vider") {
    console.log("Annule.\n");
    return;
  }

  console.log("\nSuppression en cours...\n");

  // ── Analytics & tracking ──
  const productViews = await prisma.productView.deleteMany();
  console.log(`  ProductView                    : ${productViews.count}`);

  const priceHistory = await prisma.priceHistory.deleteMany();
  console.log(`  PriceHistory                   : ${priceHistory.count}`);

  // ── Restock alerts, favorites ──
  const restockAlerts = await prisma.restockAlert.deleteMany();
  console.log(`  RestockAlert                   : ${restockAlerts.count}`);

  const favorites = await prisma.favorite.deleteMany();
  console.log(`  Favorite                       : ${favorites.count}`);

  // ── Cart ──
  const cartItems = await prisma.cartItem.deleteMany();
  console.log(`  CartItem                       : ${cartItems.count}`);

  const carts = await prisma.cart.deleteMany();
  console.log(`  Cart                           : ${carts.count}`);

  // ── Stock movements ──
  const stockMovements = await prisma.stockMovement.deleteMany();
  console.log(`  StockMovement                  : ${stockMovements.count}`);

  // ── Promotions (usage first, then scopes, then promotions) ──
  const promotionUsages = await prisma.promotionUsage.deleteMany();
  console.log(`  PromotionUsage                 : ${promotionUsages.count}`);

  const promotionProducts = await prisma.promotionProduct.deleteMany();
  console.log(`  PromotionProduct               : ${promotionProducts.count}`);

  const promotionCollections = await prisma.promotionCollection.deleteMany();
  console.log(`  PromotionCollection            : ${promotionCollections.count}`);

  const promotionCategories = await prisma.promotionCategory.deleteMany();
  console.log(`  PromotionCategory              : ${promotionCategories.count}`);

  const promotions = await prisma.promotion.deleteMany();
  console.log(`  Promotion                      : ${promotions.count}`);

  // ── Credits ──
  const creditUsages = await prisma.creditUsage.deleteMany();
  console.log(`  CreditUsage                    : ${creditUsages.count}`);

  const credits = await prisma.credit.deleteMany();
  console.log(`  Credit                         : ${credits.count}`);

  // ── Claims (SAV) ──
  const claimItems = await prisma.claimItem.deleteMany();
  console.log(`  ClaimItem                      : ${claimItems.count}`);

  const claimImages = await prisma.claimImage.deleteMany();
  console.log(`  ClaimImage                     : ${claimImages.count}`);

  const claimReturns = await prisma.claimReturn.deleteMany();
  console.log(`  ClaimReturn                    : ${claimReturns.count}`);

  const claimReships = await prisma.claimReship.deleteMany();
  console.log(`  ClaimReship                    : ${claimReships.count}`);

  // ── Messagerie ──
  const messageAttachments = await prisma.messageAttachment.deleteMany();
  console.log(`  MessageAttachment              : ${messageAttachments.count}`);

  const messages = await prisma.message.deleteMany();
  console.log(`  Message                        : ${messages.count}`);

  const conversations = await prisma.conversation.deleteMany();
  console.log(`  Conversation                   : ${conversations.count}`);

  // ── Claims (after conversations because of FK) ──
  const claims = await prisma.claim.deleteMany();
  console.log(`  Claim                          : ${claims.count}`);

  // ── Orders ──
  const orderItemModifications = await prisma.orderItemModification.deleteMany();
  console.log(`  OrderItemModification          : ${orderItemModifications.count}`);

  const orderItems = await prisma.orderItem.deleteMany();
  console.log(`  OrderItem                      : ${orderItems.count}`);

  const orders = await prisma.order.deleteMany();
  console.log(`  Order                          : ${orders.count}`);

  // ── Shipping addresses ──
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

  // ── Product data ──
  const productColorImages = await prisma.productColorImage.deleteMany();
  console.log(`  ProductColorImage              : ${productColorImages.count}`);

  const productColorSubColors = await prisma.productColorSubColor.deleteMany();
  console.log(`  ProductColorSubColor           : ${productColorSubColors.count}`);

  const variantSizes = await prisma.variantSize.deleteMany();
  console.log(`  VariantSize                    : ${variantSizes.count}`);

  const productColors = await prisma.productColor.deleteMany();
  console.log(`  ProductColor                   : ${productColors.count}`);

  const productSimilar = await prisma.productSimilar.deleteMany();
  console.log(`  ProductSimilar                 : ${productSimilar.count}`);

  const productBundles = await prisma.productBundle.deleteMany();
  console.log(`  ProductBundle                  : ${productBundles.count}`);

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

  // ── Import ──
  const importDrafts = await prisma.importDraft.deleteMany();
  console.log(`  ImportDraft                    : ${importDrafts.count}`);

  const importJobs = await prisma.importJob.deleteMany();
  console.log(`  ImportJob                      : ${importJobs.count}`);

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

  const seasons = await prisma.season.deleteMany();
  console.log(`  Season                         : ${seasons.count}`);

  const countryTranslations = await prisma.manufacturingCountryTranslation.deleteMany();
  console.log(`  ManufacturingCountryTranslation: ${countryTranslations.count}`);

  const countries = await prisma.manufacturingCountry.deleteMany();
  console.log(`  ManufacturingCountry           : ${countries.count}`);

  // ── Sizes ──
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

  // ── Translation quotas ──
  const translationQuotas = await prisma.translationQuota.deleteMany();
  console.log(`  TranslationQuota               : ${translationQuotas.count}`);

  // ── Site config ──
  const siteConfig = await prisma.siteConfig.deleteMany();
  console.log(`  SiteConfig                     : ${siteConfig.count}`);

  // ── Stripe webhook events ──
  const stripeEvents = await prisma.stripeWebhookEvent.deleteMany();
  console.log(`  StripeWebhookEvent             : ${stripeEvents.count}`);

  // ── Auth / security (logs only, NOT users) ──
  const passwordResetTokens = await prisma.passwordResetToken.deleteMany();
  console.log(`  PasswordResetToken             : ${passwordResetTokens.count}`);

  const loginOtps = await prisma.loginOtp.deleteMany();
  console.log(`  LoginOtp                       : ${loginOtps.count}`);

  const loginAttempts = await prisma.loginAttempt.deleteMany();
  console.log(`  LoginAttempt                   : ${loginAttempts.count}`);

  const accountLockouts = await prisma.accountLockout.deleteMany();
  console.log(`  AccountLockout                 : ${accountLockouts.count}`);

  const registrationLogs = await prisma.registrationLog.deleteMany();
  console.log(`  RegistrationLog                : ${registrationLogs.count}`);

  // ── Users : NON SUPPRIMES ──
  console.log(`\n  User (conserves)               : ${userCount}`);

  console.log("\n========================================");
  console.log("   Base nettoyee — comptes conserves");
  console.log("========================================\n");
}

main()
  .catch((e) => {
    console.error("Erreur :", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
