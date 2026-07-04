// Backfill Order.paidSubtotalHT pour les commandes existantes
// (rempli avec subtotalHT actuel — approximation acceptable pour l'historique)
// Usage : npx tsx scripts/backfill-paid-subtotal-ht.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: { paidSubtotalHT: null },
    select: { id: true, subtotalHT: true, orderNumber: true },
  });

  console.log(`Backfill de ${orders.length} commandes…`);
  for (const o of orders) {
    await prisma.order.update({
      where: { id: o.id },
      data: { paidSubtotalHT: o.subtotalHT },
    });
  }
  console.log(`✔ Terminé.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
