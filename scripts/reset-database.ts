/**
 * Vide la base de données sauf :
 *   - Comptes utilisateurs (+ adresses)
 *   - Paramètres admin (SiteConfig, CompanyInfo, documents légaux)
 *
 * Usage : npx tsx scripts/reset-database.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

const KEEP_TABLES = [
  "User",
  "ShippingAddress",
  "SiteConfig",
  "CompanyInfo",
  "LegalDocument",
  "LegalDocumentVersion",
];

// Ordre arbitraire — les contraintes FK sont désactivées le temps du wipe.
const TABLES_TO_CLEAR = [
  // Analytics / historique
  "ProductView",
  "PriceHistory",
  "StockMovement",
  "RestockAlert",
  "Favorite",
  // Catalogues / Collections
  "CatalogProduct",
  "Catalog",
  "CollectionProduct",
  "CollectionTranslation",
  "Collection",
  // Panier
  "CartItem",
  "Cart",
  // Promotions
  "PromotionUsage",
  "PromotionProduct",
  "PromotionCategory",
  "PromotionCollection",
  "Promotion",
  // Avoirs
  "CreditUsage",
  "Credit",
  // SAV / Messagerie
  "ClaimItem",
  "ClaimImage",
  "ClaimReturn",
  "ClaimReship",
  "MessageAttachment",
  "Message",
  "Conversation",
  "Claim",
  // Commandes
  "OrderItemModification",
  "OrderItem",
  "Order",
  // Stripe
  "StripeWebhookEvent",
  // Imports
  "ImportJob",
  "ImportDraft",
  // Codes d'accès invité
  "AccessCodeView",
  "AccessCode",
  // Sécurité / auth transitoire
  "PasswordResetToken",
  "LoginOtp",
  "LoginAttempt",
  "AccountLockout",
  "RegistrationLog",
  // Liens en attente
  "PendingSimilar",
  // Produits
  "PackColorLineSize",
  "PackColorLine",
  "VariantSize",
  "ProductColorImage",
  "ProductColor",
  "ProductBundle",
  "ProductSimilar",
  "ProductTag",
  "ProductTranslation",
  "ProductComposition",
  "_ProductSubCategories", // table de jointure implicite Prisma
  "Product",
  // Référentiels
  "TagTranslation",
  "Tag",
  "CompositionTranslation",
  "Composition",
  "SeasonTranslation",
  "Season",
  "ManufacturingCountryTranslation",
  "ManufacturingCountry",
  "ColorTranslation",
  "Color",
  "SubCategoryTranslation",
  "SubCategory",
  "CategoryTranslation",
  "Category",
  // Tailles
  "Size",
  // Quotas traduction
  "TranslationQuota",
];

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function main() {
  console.log("\n========================================");
  console.log("   Reset de la base de données");
  console.log("========================================\n");
  console.log("Sera CONSERVÉ :");
  console.log(`  ${KEEP_TABLES.join(", ")}\n`);
  console.log("Sera VIDÉ :");
  console.log(`  ${TABLES_TO_CLEAR.length} tables (produits, commandes, panier, SAV, etc.)\n`);

  const answer = await ask("Tapez 'OUI' pour confirmer : ");
  if (answer !== "OUI") {
    console.log("Annulé.\n");
    return;
  }

  console.log("\nDésactivation des contraintes FK...");
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");

  let ok = 0;
  let ko = 0;
  for (const table of TABLES_TO_CLEAR) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
      console.log(`  ok  ${table}`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ko  ${table} -> ${msg}`);
      ko++;
    }
  }

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");

  console.log(`\nTerminé. ${ok} tables vidées, ${ko} en erreur.\n`);
}

main()
  .catch((e) => {
    console.error("Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
