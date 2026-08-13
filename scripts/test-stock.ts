process.env.MULTI_TENANT_SCOPE = "off";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { readProductByIdWithRetry } from "@/lib/ankorstore-bo";

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: "PRODUCTTESTANKORSTORE" },
    select: {
      id: true, tenantId: true, ankorsProductId: true,
      colors: { select: { id: true, stock: true, color: { select: { name: true } } } },
    },
  });
  if (!p) throw new Error("produit introuvable");
  console.log("Produit BJ:", p.id, "ankorsProductId:", p.ankorsProductId);
  console.log("Couleurs actuelles:");
  for (const c of p.colors) {
    console.log(`  ${c.color?.name}: stock BJ = ${c.stock}, colorId = ${c.id}`);
  }

  // Change le stock à une valeur aléatoire
  const newStock = Math.floor(Math.random() * 90) + 10; // 10-99
  console.log(`\n→ Nouveau stock BJ : ${newStock}`);
  await prisma.productColor.update({
    where: { id: p.colors[0].id },
    data: { stock: newStock },
  });

  // Vérif que le stock est bien enregistré + status ONLINE
  const check = await prisma.product.findUnique({
    where: { id: p.id },
    select: {
      status: true,
      colors: { select: { id: true, stock: true, disabled: true, saleType: true, color: { select: { name: true } } } },
    },
  });
  console.log("Vérif après update:");
  console.log("  status BJ:", check?.status);
  for (const c of check?.colors ?? []) {
    console.log(`  ${c.color?.name}: stock=${c.stock} disabled=${c.disabled} saleType=${c.saleType}`);
  }

  await tenantALS.run(p.tenantId, async () => {
    console.log("→ Publish BJ → Ankor…");
    const { publishProductToAnkorstoreBo } = await import("@/app/actions/admin/ankorstore-bo");
    const r = await publishProductToAnkorstoreBo(p.id);
    if (!r.success) {
      console.log("❌ publish échoué:", r.error);
      return;
    }
    console.log("✅ publish OK");
    console.log("→ Lecture côté Ankor…");
    await new Promise((res) => setTimeout(res, 2000));
    const ankor = await readProductByIdWithRetry(r.ankorProductId!);
    console.log("Variantes chez Ankor:");
    for (const v of ankor?.variants ?? []) {
      console.log(`  sku=${v.sku}  stock=${v.stock?.stock_quantity}  policy=${v.stock?.inventory_policy}  status=${v.stock?.status}`);
    }
    console.log("\nAttendu:", newStock, "  reçu:", ankor?.variants?.[0]?.stock?.stock_quantity);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
