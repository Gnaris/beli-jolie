/**
 * Délie en masse tous les produits locaux d'Ankorstore.
 *
 * Effet en base :
 *   - Product.ankorsProductId      → null
 *   - Product.ankorsLastSyncSnapshot → null
 *   - ProductColor.ankorsVariantId → null
 *   - AnkorstoreOperation status PENDING → CANCELLED (libère le verrou côté
 *     notre BDD qui empêcherait une nouvelle synchro)
 *
 * Aucun appel à l'API Ankorstore : les fiches côté Ankorstore restent
 * intactes (on peut les retrouver via le matching référence/SKU).
 *
 * Usage :
 *   npx tsx scripts/unlink-all-ankorstore.ts confirmer
 *
 * Le mot-clé `confirmer` est obligatoire — sans lui, le script affiche
 * juste un compte-rendu de ce qui SERAIT fait, sans rien modifier.
 */

import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function main() {
  const confirm = process.argv[2] === "confirmer";

  const linkedProducts = await prisma.product.count({
    where: { ankorsProductId: { not: null } },
  });
  const linkedVariants = await prisma.productColor.count({
    where: { ankorsVariantId: { not: null } },
  });
  const pendingOps = await prisma.ankorstoreOperation.count({
    where: { status: "PENDING" },
  });

  console.log("État actuel :");
  console.log(`  - Produits avec ankorsProductId : ${linkedProducts}`);
  console.log(`  - Variantes avec ankorsVariantId : ${linkedVariants}`);
  console.log(`  - Opérations Ankorstore en attente (PENDING) : ${pendingOps}`);
  console.log("");

  if (!confirm) {
    console.log("Mode simulation — aucune écriture effectuée.");
    console.log("Pour exécuter réellement la déliaison, relancez avec :");
    console.log("  npx tsx scripts/unlink-all-ankorstore.ts confirmer");
    await prisma.$disconnect();
    return;
  }

  console.log("Déliaison en cours…");
  const updProducts = await prisma.product.updateMany({
    where: { ankorsProductId: { not: null } },
    data: { ankorsProductId: null, ankorsLastSyncSnapshot: Prisma.DbNull },
  });
  const updVariants = await prisma.productColor.updateMany({
    where: { ankorsVariantId: { not: null } },
    data: { ankorsVariantId: null },
  });
  const cancelledOps = await prisma.ankorstoreOperation.updateMany({
    where: { status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  console.log(`OK : ${updProducts.count} produits déliés, ${updVariants.count} variantes déliées, ${cancelledOps.count} opérations annulées.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
