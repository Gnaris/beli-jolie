import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const orphans = await p.product.findMany({
    where: { tenantId: null, reference: { startsWith: "DEMO-" } },
    select: { id: true, reference: true, name: true },
  });
  console.log(`Orphelins DEMO-*: ${orphans.length}`);
  for (const o of orphans) console.log(`  ${o.reference} / ${o.name}`);
  const del = await p.product.deleteMany({ where: { tenantId: null, reference: { startsWith: "DEMO-" } } });
  console.log(`Supprimé ${del.count} orphelins`);
}
main().finally(() => p.$disconnect());
