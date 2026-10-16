/**
 * Remet une commande dans son état initial (annule toutes les modifications
 * d'articles, retire les articles ajoutés, annule les OrderPayment SUPPLEMENT).
 *
 * Usage :
 *   npx tsx scripts/reset-order-to-initial.ts <orderId>
 */
import { PrismaClient } from "@prisma/client";
import { recomputeOrderTotals } from "../lib/order-totals";

const prisma = new PrismaClient();

async function main() {
  const orderId = process.argv[2];
  if (!orderId) {
    console.error("Usage : npx tsx scripts/reset-order-to-initial.ts <orderId>");
    process.exit(1);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      itemModifications: true,
    },
  });
  if (!order) {
    console.error(`Commande ${orderId} introuvable.`);
    process.exit(1);
  }

  console.log(`[reset] Commande ${order.orderNumber} (${order.id})`);
  console.log(`  status=${order.status} paymentStatus=${order.paymentStatus} paymentMode=${order.paymentMode}`);
  console.log(`  totalTTC=${order.totalTTC}  paidSubtotalHT=${order.paidSubtotalHT}`);
  console.log(`  items=${order.items.length}  mods=${order.itemModifications.length}  compensations=${order.items.filter((i) => i.isCompensation).length}`);

  // OrderPayment via SQL brut (le client Prisma peut ne pas être regénéré encore).
  const supplementCount = await prisma.$executeRawUnsafe(
    `UPDATE OrderPayment SET status='CANCELLED', cancelledAt=NOW() WHERE orderId=? AND kind='SUPPLEMENT' AND status<>'CANCELLED'`,
    orderId,
  );
  console.log(`  OrderPayment SUPPLEMENT annulés : ${supplementCount}`);

  await prisma.$transaction(async (tx) => {
    // Restaure chaque article modifié.
    for (const mod of order.itemModifications) {
      const item = await tx.orderItem.findUnique({ where: { id: mod.orderItemId } });
      if (!item) continue;
      const restoredPrice = mod.originalUnitPrice ? Number(mod.originalUnitPrice) : Number(item.unitPrice);
      await tx.orderItem.update({
        where: { id: mod.orderItemId },
        data: {
          quantity: mod.originalQuantity,
          unitPrice: restoredPrice,
          lineTotal: mod.originalQuantity * restoredPrice,
          lineDiscountAmt: null,
          lineDiscountType: null,
          lineDiscountValue: null,
        },
      });
    }
    // Supprime toutes les modifications tracées.
    await tx.orderItemModification.deleteMany({ where: { orderId } });
    // Supprime les articles de compensation (ajoutés après coup).
    const comp = await tx.orderItem.deleteMany({ where: { orderId, isCompensation: true } });
    console.log(`  Articles de compensation supprimés : ${comp.count}`);

    // Recompute les totaux depuis les items restaurés.
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const updatedItems = await tx.orderItem.findMany({ where: { orderId } });
    // Reset explicite : on repart sans remise commerciale offerte sur modif.
    const totals = recomputeOrderTotals({
      items: updatedItems,
      tvaRate: fresh.tvaRate,
      carrierPrice: fresh.carrierPrice,
      clientDiscountType: fresh.clientDiscountType,
      clientDiscountValue: fresh.clientDiscountValue,
      commercialGiftHT: 0,
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotalHT: totals.subtotalHT,
        tvaAmount: totals.tvaAmount,
        totalTTC: totals.totalTTC,
        clientDiscountAmt: totals.clientDiscountAmt,
        commercialGiftHT: 0,
      },
    });
    console.log(`  Totaux recalculés : HT=${totals.subtotalHT} TTC=${totals.totalTTC}`);
  });

  // Vérifie que la commande dispose bien d'un OrderPayment INITIAL PAID. Si
  // elle n'a jamais été backfillée, on en crée un maintenant du montant total
  // restauré (c'est ce qu'a réglé la cliente à l'origine).
  const freshAfter = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      tenantId: true,
      totalTTC: true,
      paymentMode: true,
      paymentStatus: true,
      stripePaymentIntentId: true,
      stripeCheckoutSessionId: true,
      stripeCheckoutSessionUrl: true,
      stripeCheckoutSessionExpiresAt: true,
      bankTransferConfirmedAt: true,
      bankTransferConfirmedBy: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const initialRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM OrderPayment WHERE orderId = ? AND kind = 'INITIAL' LIMIT 1`,
    orderId,
  );
  if (initialRows.length === 0) {
    const method =
      freshAfter.paymentMode === "BANK_TRANSFER"
        ? "BANK_TRANSFER"
        : freshAfter.paymentMode === "STRIPE_LINK"
          ? "STRIPE_LINK"
          : freshAfter.paymentMode === "PAY_ON_PICKUP"
            ? "PAY_ON_PICKUP"
            : freshAfter.paymentMode === "CREDIT"
              ? "CREDIT"
              : "CARD";
    const status = freshAfter.paymentStatus === "paid" ? "PAID" : "PENDING";
    await prisma.$executeRawUnsafe(
      `INSERT INTO OrderPayment
         (id, orderId, tenantId, kind, method, status, amount,
          stripePaymentIntentId, stripeCheckoutSessionId, stripeCheckoutUrl, stripeExpiresAt,
          paidAt, confirmedAt, confirmedBy, createdAt, updatedAt)
       VALUES (?, ?, ?, 'INITIAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      `cm${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36).slice(-6)}`,
      orderId,
      freshAfter.tenantId,
      method,
      status,
      Number(freshAfter.totalTTC),
      freshAfter.stripePaymentIntentId,
      freshAfter.stripeCheckoutSessionId,
      freshAfter.stripeCheckoutSessionUrl,
      freshAfter.stripeCheckoutSessionExpiresAt,
      status === "PAID" ? freshAfter.updatedAt : null,
      freshAfter.bankTransferConfirmedAt,
      freshAfter.bankTransferConfirmedBy,
      freshAfter.createdAt,
    );
    console.log(`  ✔ OrderPayment INITIAL créé : ${method}/${status} - ${freshAfter.totalTTC} €`);
  } else {
    // Déjà présent : on s'assure qu'il est PAID et bien aligné sur le total.
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE OrderPayment
          SET status = 'PAID',
              amount = ?,
              paidAt = COALESCE(paidAt, ?)
        WHERE orderId = ? AND kind = 'INITIAL'`,
      Number(freshAfter.totalTTC),
      freshAfter.updatedAt,
      orderId,
    );
    console.log(`  ✔ OrderPayment INITIAL remis à PAID (${updated} ligne(s)).`);
  }

  // Assure que la commande est bien `paymentStatus='paid'` (puisque l'initial
  // est payé et aucun SUPPLEMENT PENDING ne subsiste).
  await prisma.order.update({
    where: { id: orderId },
    data: { paymentStatus: "paid" },
  });

  console.log("[reset] ✔ Commande remise à zéro.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
