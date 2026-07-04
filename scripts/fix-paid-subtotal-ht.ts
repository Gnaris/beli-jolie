// Reconstitue paidSubtotalHT en additionnant subtotalHT actuel + toutes les
// priceDifference des modifications enregistrées + tout ce qui vient de compensation.
// Cela reconstitue le HT initial "au moment du paiement Stripe".
// Usage : npx tsx scripts/fix-paid-subtotal-ht.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    include: {
      itemModifications: true,
      items: { where: { isCompensation: true } },
    },
  });

  let updated = 0;
  for (const o of orders) {
    const diffs = o.itemModifications.reduce((s, m) => s + Number(m.priceDifference), 0);
    const compensationTotal = o.items.reduce((s, i) => s + Number(i.lineTotal), 0);
    // HT initial = HT actuel + avoirs dus (diffs positives) - articles ajoutés en compensation
    const initialHT = Number(o.subtotalHT) + diffs - compensationTotal;

    // Ne mettre à jour que si le calcul donne un résultat cohérent (> 0)
    if (initialHT > 0) {
      await prisma.order.update({
        where: { id: o.id },
        data: { paidSubtotalHT: initialHT },
      });
      updated++;
      console.log(`✔ ${o.orderNumber} : paidSubtotalHT → ${initialHT.toFixed(2)} €`);
    }
  }
  console.log(`\nTerminé : ${updated} commande(s) mise(s) à jour.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
