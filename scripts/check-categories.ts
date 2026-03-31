import { prisma } from "../lib/prisma";

async function main() {
  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  console.log("Categories:", cats.length);
  for (const c of cats) {
    console.log(`  ${c.id}: ${c.name}`);
  }
  await prisma.$disconnect();
}

main().catch(console.error);
