import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const r = await p.product.findFirst({
    where: { reference: "DEMO-001" },
    select: { id: true, reference: true, tenantId: true, name: true },
  });
  console.log("DEMO-001:", r);
}
main().finally(() => p.$disconnect());
