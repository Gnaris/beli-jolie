import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    console.log(`\n─── Tenant ${tenant.slug} ───`);
    await tenantALS.run(tenant.id, async () => {
      const rows = await prisma.product.findMany({
        where: { reference: { contains: "E292" } },
        select: { id: true, reference: true, name: true, status: true, pfsProductId: true },
        take: 20,
      });
      console.log(`Trouvé ${rows.length} produit(s) matchant "E292" :`);
      for (const r of rows) {
        console.log(`  • ${r.reference} — ${r.name} [${r.status}] pfsProductId=${r.pfsProductId ?? "-"}`);
      }

      const rowsLower = await prisma.product.findMany({
        where: { reference: { contains: "e292" } },
        select: { id: true, reference: true, name: true, status: true, pfsProductId: true },
        take: 20,
      });
      console.log(`Trouvé ${rowsLower.length} produit(s) matchant "e292" :`);
      for (const r of rowsLower) {
        console.log(`  • ${r.reference} — ${r.name} [${r.status}] pfsProductId=${r.pfsProductId ?? "-"}`);
      }
    });
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
