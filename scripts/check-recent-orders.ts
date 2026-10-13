import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      items: {
        select: { imagePath: true, productRef: true, colorName: true },
      },
    },
  });
  for (const o of orders) {
    const total = o.items.length;
    const withImg = o.items.filter((i) => !!i.imagePath).length;
    const flag = withImg === total ? "✓" : withImg === 0 ? "✗" : "~";
    console.log(
      `${flag} ${o.orderNumber} (${o.id}) · ${o.createdAt.toISOString().slice(0, 10)} · ${withImg}/${total} avec image`,
    );
  }
}

main().finally(() => prisma.$disconnect());
