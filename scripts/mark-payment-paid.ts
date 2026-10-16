/**
 * Marque manuellement un OrderPayment comme PAID (utile en dev local quand le
 * webhook Stripe n'est pas écouté par la CLI). Met aussi à jour
 * `Order.paymentStatus = "paid"` si le total encaissé couvre le TTC.
 *
 * Usage :
 *   npx tsx scripts/mark-payment-paid.ts <paymentId>
 *   npx tsx scripts/mark-payment-paid.ts --last-pending <orderId>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  let paymentId: string | null = null;

  if (args[0] === "--last-pending" && args[1]) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM OrderPayment WHERE orderId = ? AND status = 'PENDING' ORDER BY createdAt DESC LIMIT 1`,
      args[1],
    );
    if (rows.length === 0) {
      console.error(`Aucun OrderPayment PENDING pour la commande ${args[1]}.`);
      process.exit(1);
    }
    paymentId = rows[0].id;
  } else if (args[0]) {
    paymentId = args[0];
  } else {
    console.error("Usage : npx tsx scripts/mark-payment-paid.ts <paymentId>");
    console.error("     ou : npx tsx scripts/mark-payment-paid.ts --last-pending <orderId>");
    process.exit(1);
  }

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE OrderPayment
        SET status = 'PAID',
            paidAt = COALESCE(paidAt, NOW()),
            confirmedAt = COALESCE(confirmedAt, NOW())
      WHERE id = ? AND status = 'PENDING'`,
    paymentId,
  );
  if (updated === 0) {
    console.error(`Paiement ${paymentId} introuvable ou plus en PENDING.`);
    process.exit(1);
  }

  const row = await prisma.$queryRawUnsafe<Array<{ orderId: string; amount: string }>>(
    `SELECT orderId, amount FROM OrderPayment WHERE id = ?`,
    paymentId,
  );
  const orderId = row[0]?.orderId;
  console.log(`  ✔ OrderPayment ${paymentId} → PAID (${row[0]?.amount} €)`);

  // Si l'encaissé couvre le TTC, on bascule aussi paymentStatus.
  const sumRows = await prisma.$queryRawUnsafe<Array<{ sum: string | null }>>(
    `SELECT COALESCE(SUM(amount), 0) AS sum FROM OrderPayment WHERE orderId = ? AND status = 'PAID'`,
    orderId,
  );
  const paidTTC = Number(sumRows[0]?.sum ?? 0);
  const orderRows = await prisma.$queryRawUnsafe<Array<{ totalTTC: string }>>(
    `SELECT totalTTC FROM \`Order\` WHERE id = ?`,
    orderId,
  );
  const totalTTC = Number(orderRows[0]?.totalTTC ?? 0);
  if (paidTTC + 0.01 >= totalTTC) {
    await prisma.$executeRawUnsafe(
      `UPDATE \`Order\` SET paymentStatus = 'paid' WHERE id = ?`,
      orderId,
    );
    console.log(`  ✔ Order ${orderId} → paymentStatus=paid (encaissé ${paidTTC} / ${totalTTC})`);
  } else {
    console.log(`  → Encaissé ${paidTTC} / ${totalTTC} — paymentStatus inchangé`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
