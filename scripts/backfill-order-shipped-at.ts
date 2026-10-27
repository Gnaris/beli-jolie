/**
 * scripts/backfill-order-shipped-at.ts
 *
 * Backfill unique après l'ajout des colonnes `Order.shippedAt` et
 * `Order.reviewRequestEmailSentAt`.
 *
 * Pour toutes les commandes déjà `status=SHIPPED` au moment du déploiement :
 *   - Pose `shippedAt = updatedAt` (approximation : updatedAt reflète la
 *     dernière mutation = généralement le passage en SHIPPED).
 *   - Pose `reviewRequestEmailSentAt = NOW()` pour marquer le mail comme
 *     « déjà envoyé » et éviter que le scheduler ne spamme les anciens
 *     clients 10 j après coup.
 *
 * À exécuter UNE SEULE FOIS après `prisma db push`. Idempotent : re-exécuter
 * n'écrase rien (filtre `shippedAt: null` + `reviewRequestEmailSentAt: null`).
 *
 * Usage :
 *   npx tsx scripts/backfill-order-shipped-at.ts            # dry-run (lecture seule)
 *   npx tsx scripts/backfill-order-shipped-at.ts --apply    # applique les mises à jour
 */

import { prisma } from "../lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const now = new Date();

  const rows = await prisma.order.findMany({
    where: {
      status: "SHIPPED",
      OR: [
        { shippedAt: null },
        { reviewRequestEmailSentAt: null },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      tenantId: true,
      updatedAt: true,
      shippedAt: true,
      reviewRequestEmailSentAt: true,
    },
  });

  console.log(`[backfill] ${rows.length} commande(s) SHIPPED à traiter`);
  if (rows.length === 0) {
    console.log("[backfill] rien à faire.");
    return;
  }

  if (!apply) {
    console.log("[backfill] DRY-RUN — ajoute --apply pour écrire.");
    for (const r of rows.slice(0, 10)) {
      console.log(`  → ${r.orderNumber} (tenant=${r.tenantId}) updatedAt=${r.updatedAt.toISOString()}`);
    }
    if (rows.length > 10) console.log(`  … et ${rows.length - 10} autre(s).`);
    return;
  }

  let done = 0;
  for (const r of rows) {
    const data: {
      shippedAt?: Date;
      reviewRequestEmailSentAt?: Date;
    } = {};
    if (!r.shippedAt) data.shippedAt = r.updatedAt;
    if (!r.reviewRequestEmailSentAt) data.reviewRequestEmailSentAt = now;

    await prisma.order.update({ where: { id: r.id }, data });
    done++;
    if (done % 50 === 0) console.log(`[backfill] ${done}/${rows.length}`);
  }
  console.log(`[backfill] terminé : ${done} commande(s) mise(s) à jour.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] échec", err);
    process.exit(1);
  });
