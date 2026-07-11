import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  // Delete all DEMO-* products regardless of tenantId
  const del = await p.product.deleteMany({ where: { reference: { startsWith: "DEMO-" } } });
  console.log(`[clean] Supprimé ${del.count} produits DEMO-*`);

  const demo = await p.tenant.findUnique({ where: { slug: "demo" } });
  const cat = await p.category.findFirst();
  if (!demo || !cat) throw new Error("demo tenant or category missing");

  for (const ref of ["DEMO-001", "DEMO-002", "DEMO-003"]) {
    await p.product.create({
      data: {
        reference: ref,
        name: `Produit ${ref}`,
        description: `Test isolation multi-tenant`,
        categoryId: cat.id,
        tenantId: demo.id,
      },
    });
  }
  const count = await p.product.count({ where: { tenantId: demo.id, reference: { startsWith: "DEMO-" } } });
  console.log(`[clean] Créé ${count} produits DEMO-* pour demo`);
}
main().finally(() => p.$disconnect());
