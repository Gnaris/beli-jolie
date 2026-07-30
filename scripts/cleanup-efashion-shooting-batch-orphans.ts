/**
 * Nettoie les items « fantômes » de la file d'attente Shooting eFashion :
 * lignes EfashionShootingBatchItem dont le productId ne correspond plus à
 * aucun Product en base (produit supprimé sans que le cascade delete ait joué).
 *
 * Usage :
 *   MULTI_TENANT_SCOPE=off npx tsx scripts/cleanup-efashion-shooting-batch-orphans.ts
 *
 * MULTI_TENANT_SCOPE=off désactive le scoping tenant : on veut passer sur
 * TOUS les tenants d'un coup pour cette maintenance ponctuelle.
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const items = await prisma.efashionShootingBatchItem.findMany({
    select: { id: true, productId: true },
  });

  if (items.length === 0) {
    console.log("File d'attente vide, rien à nettoyer.");
    return;
  }

  const productIds = Array.from(new Set(items.map((it) => it.productId)));
  const existing = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));

  const orphans = items.filter((it) => !existingIds.has(it.productId));
  if (orphans.length === 0) {
    console.log(`Aucun orphelin trouvé (${items.length} items sains).`);
    return;
  }

  console.log(`Suppression de ${orphans.length} orphelin(s) sur ${items.length} items :`);
  for (const o of orphans) console.log(`  - item ${o.id} → productId manquant ${o.productId}`);

  const result = await prisma.efashionShootingBatchItem.deleteMany({
    where: { id: { in: orphans.map((o) => o.id) } },
  });
  console.log(`✅ ${result.count} ligne(s) supprimée(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
