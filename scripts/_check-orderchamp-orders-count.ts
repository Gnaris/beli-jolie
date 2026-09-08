import { prisma } from "@/lib/prisma";

async function main() {
  const a = await prisma.orderchampOrder.count();
  const b = await prisma.orderchampOrderItem.count();
  const c = await prisma.adminClientCard.count({ where: { hasOrderchamp: true } });
  console.log(JSON.stringify({ orderchampOrder: a, orderchampOrderItem: b, adminClientCardOC: c }, null, 2));
  await prisma.$disconnect();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
