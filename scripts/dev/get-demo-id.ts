import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const r = await p.product.findFirst({ where: { reference: "DEMO-001" } });
  console.log("DEMO-001 id=", r?.id);
}
main().finally(() => p.$disconnect());
