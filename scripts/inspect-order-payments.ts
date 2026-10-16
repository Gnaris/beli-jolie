/**
 * Inspection rapide des OrderPayment d'une commande (SQL brut car le client
 * Prisma peut ne pas être regénéré selon l'état du dev server).
 *
 * Usage : npx tsx scripts/inspect-order-payments.ts <orderId>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error("Usage : npx tsx scripts/inspect-order-payments.ts <orderId>");
    process.exit(1);
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      kind: string;
      method: string;
      status: string;
      amount: string;
      createdAt: Date;
      paidAt: Date | null;
    }>
  >(
    `SELECT id, kind, method, status, amount, createdAt, paidAt
       FROM OrderPayment
      WHERE orderId = ?
      ORDER BY createdAt ASC`,
    orderId,
  );
  console.log(`[inspect] ${rows.length} OrderPayment pour ${orderId}`);
  for (const r of rows) {
    console.log(
      `  - ${r.kind.padEnd(10)} ${r.method.padEnd(15)} ${r.status.padEnd(10)} ${r.amount} € (créé ${r.createdAt.toISOString()}, payé ${r.paidAt?.toISOString() ?? "-"})`,
    );
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
