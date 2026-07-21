// Backfill AdminClientCard.lastOrderAt en repartant de MAX(PfsOrder.createdAtPfs).
// Corrige le bug où toutes les fiches étaient datées d'aujourd'hui après un
// import PFS (lastOrderAt = new Date() au lieu de la vraie date de commande).
// Usage : MULTI_TENANT_SCOPE=off npx tsx scripts/backfill-admin-client-card-last-order-at.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cards = await prisma.adminClientCard.findMany({
    where: { hasPfs: true },
    select: { id: true, tenantId: true, lastOrderAt: true, firstName: true, lastName: true },
  });

  console.log(`Backfill lastOrderAt sur ${cards.length} fiches PFS…`);

  let updated = 0;
  let unchanged = 0;
  let noOrder = 0;

  for (const card of cards) {
    const agg = await prisma.pfsOrder.aggregate({
      where: { adminClientCardId: card.id },
      _max: { createdAtPfs: true },
    });
    const trueLastOrder = agg._max.createdAtPfs;
    if (!trueLastOrder) {
      noOrder++;
      continue;
    }
    if (
      card.lastOrderAt &&
      Math.abs(card.lastOrderAt.getTime() - trueLastOrder.getTime()) < 1000
    ) {
      unchanged++;
      continue;
    }
    await prisma.adminClientCard.update({
      where: { id: card.id },
      data: { lastOrderAt: trueLastOrder },
    });
    updated++;
  }

  console.log(`✔ Mise à jour : ${updated} · déjà correct : ${unchanged} · sans commande PFS : ${noOrder}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
