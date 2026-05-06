/**
 * Vide toutes les commandes de test et leurs dépendances.
 * À exécuter avant `npx prisma db push` quand on simplifie l'enum OrderStatus
 * (suppression de PROCESSING / DELIVERED) — sinon MySQL refuse l'ALTER TABLE
 * sur les lignes utilisant les valeurs supprimées.
 *
 * Usage : npx tsx scripts/wipe-test-orders.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("→ Suppression des dépendances liées aux commandes…");

  await prisma.claimReship.deleteMany({});
  await prisma.claimReturn.deleteMany({});
  await prisma.claimImage.deleteMany({});
  await prisma.claimItem.deleteMany({});
  await prisma.claim.deleteMany({});

  await prisma.orderItemModification.deleteMany({});
  await prisma.creditUsage.deleteMany({});
  await prisma.promotionUsage.deleteMany({});
  await prisma.stockMovement.deleteMany({ where: { orderId: { not: null } } });
  await prisma.orderItem.deleteMany({});

  const { count } = await prisma.order.deleteMany({});
  console.log(`✓ ${count} commande(s) supprimée(s).`);
}

main()
  .catch((err) => {
    console.error("✗ Erreur :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
