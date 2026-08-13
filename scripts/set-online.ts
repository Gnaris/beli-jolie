process.env.MULTI_TENANT_SCOPE = "off";
import { prisma } from "@/lib/prisma";
async function main() {
  const r = await prisma.product.updateMany({
    where: { reference: "PRODUCTTESTANKORSTORE" },
    data: { status: "ONLINE" },
  });
  console.log("Mis en ONLINE:", r.count, "produit(s)");
}
main().catch(console.error).finally(() => prisma.$disconnect());
