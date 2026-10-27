/**
 * Nettoie les lignes orphelines dans CollectionProduct et CollectionExclusion :
 * celles qui pointent vers un Product qui n'existe plus (produit supprimé
 * avant que la cascade ne soit en place, ou suppression manuelle en SQL).
 *
 * Symptôme corrigé : la page /admin/collections/[id]/modifier plantait avec
 *   "Inconsistent query result: Field product is required to return data,
 *    got `null` instead."
 * dès qu'une collection contenait une liaison fantôme.
 *
 * Usage :
 *   npx tsx scripts/cleanup-orphan-collection-products.ts            → dry-run
 *   npx tsx scripts/cleanup-orphan-collection-products.ts --apply    → applique
 *
 * Idempotent, scope désactivé (balaie tous les tenants).
 */

process.env.MULTI_TENANT_SCOPE = "off";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const [cpRows, exRows] = await Promise.all([
    prisma.collectionProduct.findMany({ select: { id: true, productId: true, collectionId: true } }),
    prisma.collectionExclusion.findMany({ select: { productId: true, collectionId: true } }),
  ]);

  const productIds = new Set<string>();
  for (const r of cpRows) productIds.add(r.productId);
  for (const r of exRows) productIds.add(r.productId);

  const existing = await prisma.product.findMany({
    where: { id: { in: Array.from(productIds) } },
    select: { id: true },
  });
  const existingSet = new Set(existing.map((p) => p.id));

  const orphanCp = cpRows.filter((r) => !existingSet.has(r.productId));
  const orphanEx = exRows.filter((r) => !existingSet.has(r.productId));

  console.log(`CollectionProduct : ${cpRows.length} au total, ${orphanCp.length} orphelin(s).`);
  console.log(`CollectionExclusion : ${exRows.length} au total, ${orphanEx.length} orphelin(s).`);

  if (orphanCp.length === 0 && orphanEx.length === 0) {
    console.log("✅ Rien à nettoyer.");
    return;
  }

  if (!apply) {
    const sampleCp = orphanCp.slice(0, 5).map((r) => `  - cp ${r.id} → productId ${r.productId}`);
    const sampleEx = orphanEx.slice(0, 5).map((r) => `  - exclusion collection ${r.collectionId} → productId ${r.productId}`);
    if (sampleCp.length > 0) console.log("Exemples CollectionProduct :\n" + sampleCp.join("\n"));
    if (sampleEx.length > 0) console.log("Exemples CollectionExclusion :\n" + sampleEx.join("\n"));
    console.log("\nℹ️  Dry-run. Relance avec --apply pour supprimer réellement.");
    return;
  }

  if (orphanCp.length > 0) {
    await prisma.collectionProduct.deleteMany({
      where: { id: { in: orphanCp.map((r) => r.id) } },
    });
    console.log(`🧹 ${orphanCp.length} CollectionProduct orphelin(s) supprimé(s).`);
  }
  if (orphanEx.length > 0) {
    for (const r of orphanEx) {
      await prisma.collectionExclusion.deleteMany({
        where: { collectionId: r.collectionId, productId: r.productId },
      });
    }
    console.log(`🧹 ${orphanEx.length} CollectionExclusion orphelin(s) supprimé(s).`);
  }
  console.log("✅ Nettoyage terminé.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
