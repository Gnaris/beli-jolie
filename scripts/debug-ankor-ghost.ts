/**
 * Inspecte le doublon fantome chez Ankor (#7298959) — le produit ancien
 * qui bloque nos SKU sans suffixe.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { readProductById, searchProducts } from "@/lib/ankorstore-bo";
import { boGet } from "@/lib/ankorstore-bo/client";

async function main() {
  const tenant = await prisma.tenant.findFirst({});
  if (!tenant) throw new Error("Aucun tenant en BDD");
  await tenantALS.run(tenant.id, async () => {
    // GET direct sans le filter[requireupdate]=0 pour voir s'il apparait dans une autre categorie
    console.log("=== GET direct filters[id]=7298959 (per_page=5, sans requireupdate) ===");
    const raw = await boGet<{ data: unknown[]; meta?: unknown }>(
      `/api/me/brand/products?fields=id,name,active&page=1&per_page=5&filters[id]=7298959`
    );
    console.log("data.length:", (raw.data ?? []).length);
    console.log(JSON.stringify(raw.data, null, 2));

    console.log("\n=== searchProducts PRODUCTTESTANKORSTORE (per_page=20) ===");
    const all = await searchProducts("PRODUCTTESTANKORSTORE", { limit: 20 });
    for (const r of all) {
      console.log(`  #${r.id} — "${r.name}" — active=${r.active}`);
      for (const v of r.variants ?? []) {
        console.log(`     variant #${v.id} sku="${v.sku}"`);
      }
    }

    const ghost = await readProductById(7298959);
    console.log("\n=== readProductById(7298959) ===");
    if (!ghost) {
      console.log("read = null — probablement archive/desactive (mais garde ses SKU reserves).");
    } else {
      console.log({
        id: ghost.id,
        name: ghost.name,
        active: ghost.active,
        link: ghost.link,
        variantCount: ghost.variants?.length ?? 0,
      });
      for (const v of ghost.variants ?? []) {
        console.log("  ", v.id, v.sku, v.options?.find((o) => o.name === "color")?.value);
      }
    }
  });
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
