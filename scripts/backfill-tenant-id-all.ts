/**
 * Backfill tenantId sur tous les modèles multi-tenant.
 * Rattache toutes les lignes existantes (tenantId NULL) au tenant `beliandjolie`.
 * Idempotent : ne touche que les lignes NULL.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SLUG = "beliandjolie";

// Liste alignée avec scripts/propagate-tenant-id.ts + les 4 modèles du vertical slice.
const MODELS = [
  // Vertical slice (déjà backfillés mais on ré-appelle par sécurité, idempotent)
  "user",
  "product",
  "order",
  "companyInfo",
  // Batch propagé
  "productTranslation",
  "productColor",
  "productColorImage",
  "productSimilar",
  "productBundle",
  "productTag",
  "productComposition",
  "productView",
  "priceHistory",
  "cart",
  "cartItem",
  "visit",
  "pendingSimilar",
  "orderItem",
  "orderItemModification",
  "favorite",
  "shippingAddress",
  "claim",
  "claimItem",
  "claimImage",
  "claimReturn",
  "claimReship",
  "credit",
  "creditUsage",
  "collection",
  "collectionTranslation",
  "collectionProduct",
  "promotion",
  "promotionCategory",
  "promotionCollection",
  "promotionProduct",
  "promotionUsage",
  "catalog",
  "catalogProduct",
  "importJob",
  "importDraft",
  "restockAlert",
  "ankorstoreOperation",
  "marketplaceRefreshJob",
  "efashionShootingBatchItem",
  "imageProcessingJob",
  "translationJob",
  "stockMovement",
  "legalDocument",
  "legalDocumentVersion",
  "conversation",
  "message",
  "messageAttachment",
  "passwordResetToken",
  "loginOtp",
  "loginAttempt",
  "accountLockout",
  "registrationLog",
  "translationQuota",
  "stripeWebhookEvent",
  "variantSize",
  "packColorLine",
  "packColorLineSize",
  "siteConfig",
] as const;

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (!tenant) {
    console.error(`[backfill-all] Tenant ${SLUG} introuvable. Lance scripts/seed-default-tenant.ts d'abord.`);
    process.exit(1);
  }
  console.log(`[backfill-all] Cible : ${tenant.slug} (${tenant.id})`);

  const results: Array<{ model: string; updated: number; remainingNull: number }> = [];

  for (const model of MODELS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[model];
    if (!delegate) {
      console.warn(`[backfill-all] Delegate absent : ${model}`);
      continue;
    }
    const before = await delegate.count({ where: { tenantId: null } });
    if (before === 0) {
      results.push({ model, updated: 0, remainingNull: 0 });
      continue;
    }
    const upd = await delegate.updateMany({ where: { tenantId: null }, data: { tenantId: tenant.id } });
    const remaining = await delegate.count({ where: { tenantId: null } });
    results.push({ model, updated: upd.count, remainingNull: remaining });
  }

  const changed = results.filter((r) => r.updated > 0);
  const orphans = results.filter((r) => r.remainingNull > 0);

  console.log(`[backfill-all] ${changed.length} modeles touches :`);
  for (const r of changed) {
    console.log(`  - ${r.model.padEnd(30, " ")} : ${r.updated} lignes -> ${SLUG}`);
  }

  if (orphans.length > 0) {
    console.error(`[backfill-all] ORPHELINS restants (bug) :`);
    for (const r of orphans) console.error(`  - ${r.model} : ${r.remainingNull}`);
    process.exit(1);
  }

  console.log(`[backfill-all] Aucun orphelin. OK.`);
}

main()
  .catch((e) => {
    console.error("[backfill-all] Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
