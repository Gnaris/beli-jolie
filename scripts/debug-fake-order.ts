import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const orders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: "TESTORD" } },
    select: {
      id: true,
      orderNumber: true,
      subtotalHT: true,
      paidSubtotalHT: true,
      totalTTC: true,
      items: {
        select: {
          productName: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          isCompensation: true,
        },
      },
      itemModifications: {
        select: {
          originalQuantity: true,
          newQuantity: true,
          originalUnitPrice: true,
          newUnitPrice: true,
          priceDifference: true,
        },
      },
    },
  });

  for (const o of orders) {
    console.log(`\n=== ${o.orderNumber} (${o.id}) ===`);
    console.log(`  paidSubtotalHT = ${o.paidSubtotalHT}`);
    console.log(`  subtotalHT actuel = ${o.subtotalHT}`);
    console.log(`  totalTTC actuel = ${o.totalTTC}`);
    console.log(`  Articles :`);
    for (const i of o.items) {
      console.log(`   - ${i.productName} · ${i.quantity} × ${i.unitPrice} = ${i.lineTotal} ${i.isCompensation ? "[compensation]" : ""}`);
    }
    console.log(`  Modifications :`);
    for (const m of o.itemModifications) {
      console.log(`   - qty ${m.originalQuantity}->${m.newQuantity} · prix ${m.originalUnitPrice}->${m.newUnitPrice} · diff ${m.priceDifference}`);
    }
  }
  await prisma.$disconnect();
}

main();
