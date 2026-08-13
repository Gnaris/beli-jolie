process.env.MULTI_TENANT_SCOPE = "off";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { readProductByIdWithRetry } from "@/lib/ankorstore-bo";

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: "PRODUCTTESTANKORSTORE" },
    select: { id: true, tenantId: true, ankorsProductId: true },
  });
  if (!p?.ankorsProductId) throw new Error("nope");

  await tenantALS.run(p.tenantId, async () => {
    console.log("→ Republish…");
    const { publishProductToAnkorstoreBo } = await import("@/app/actions/admin/ankorstore-bo");
    const r = await publishProductToAnkorstoreBo(p.id);
    if (!r.success) return console.log("❌", r.error);
    console.log("✅");
    await new Promise((res) => setTimeout(res, 3000));
    const a = await readProductByIdWithRetry(Number(p.ankorsProductId!));
    console.log("\n=== ÉTAT CHEZ ANKOR ===");
    console.log("Images produit-père (", a?.images?.length ?? 0, "):");
    for (const i of a?.images ?? []) console.log("  ", i);
    console.log("Variantes (", a?.variants?.length ?? 0, "):");
    for (const v of a?.variants ?? []) {
      console.log(`  ${v.sku}  (${v.options.find((o: any) => o.name === "color")?.value})  stock=${v.stock?.stock_quantity}  images=${v.images?.length ?? "null"}`);
      for (const im of v.images ?? []) console.log("    ", im);
    }
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
