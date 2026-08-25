/**
 * Reset TOUTES les liaisons produits ↔ Microstore côté BJ (local only, ne
 * touche PAS aux fiches côté Microstore lui-même). Utile pour tester le
 * premier push from scratch sans écraser ni dupliquer les fiches MC.
 *
 * Champs reset :
 *   - Product.microstoreProductId       → null
 *   - Product.microstoreLastPushedAt    → null
 *   - Product.microstoreSyncRequired    → false
 *   - Product.microstoreLastSyncSnapshot→ null (si présent)
 *   - ProductColor.microstoreVariantId  → null
 *
 * Usage :
 *   npx tsx scripts/unlink-all-microstore.ts             # dry-run
 *   npx tsx scripts/unlink-all-microstore.ts --apply     # écrit en BDD
 *   npx tsx scripts/unlink-all-microstore.ts --apply --tenant beli-jolie
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const tenantIdx = process.argv.indexOf("--tenant");
const TENANT_SLUG = tenantIdx >= 0 ? process.argv[tenantIdx + 1] : "beli-jolie";

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    console.error(`Tenant "${TENANT_SLUG}" introuvable.`);
    process.exit(1);
  }
  console.log(`[unlink] Tenant : ${tenant.slug}`);
  console.log(`[unlink] Mode  : ${APPLY ? "🔧 APPLY (écrit)" : "🔍 DRY-RUN"}`);

  const linkedProducts = await prisma.product.count({
    where: { tenantId: tenant.id, microstoreProductId: { not: null } },
  });
  const linkedVariants = await prisma.productColor.count({
    where: { product: { tenantId: tenant.id }, microstoreVariantId: { not: null } },
  });
  const flaggedProducts = await prisma.product.count({
    where: {
      tenantId: tenant.id,
      OR: [
        { microstoreLastPushedAt: { not: null } },
        { microstoreSyncRequired: true },
      ],
    },
  });

  console.log(`\nÉtat actuel :`);
  console.log(`  · Produits avec microstoreProductId : ${linkedProducts}`);
  console.log(`  · Variantes avec microstoreVariantId: ${linkedVariants}`);
  console.log(`  · Produits avec push/sync flag      : ${flaggedProducts}`);

  if (!APPLY) {
    console.log(`\n💡 Rien écrit — relance avec --apply pour appliquer.`);
    await prisma.$disconnect();
    return;
  }

  const [p1, v1] = await prisma.$transaction([
    prisma.product.updateMany({
      where: { tenantId: tenant.id },
      data: {
        microstoreProductId: null,
        microstoreLastPushedAt: null,
        microstoreSyncRequired: false,
        microstoreLastSyncSnapshot: null,
      } as never,
    }),
    prisma.productColor.updateMany({
      where: { product: { tenantId: tenant.id } },
      data: { microstoreVariantId: null } as never,
    }),
  ]);
  console.log(`\n✅ Reset appliqué :`);
  console.log(`  · Product rows updated       : ${p1.count}`);
  console.log(`  · ProductColor rows updated  : ${v1.count}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
