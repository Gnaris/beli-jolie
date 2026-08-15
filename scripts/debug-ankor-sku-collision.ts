/**
 * Debug ponctuel : inspecte l'état d'un produit BJ + ce que Ankor renvoie
 * quand on relit par ankorsProductId. But : comprendre pourquoi un simple
 * update stock cause "The SKU is already assigned to another product variant".
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { readProductById, searchProducts } from "@/lib/ankorstore-bo";

async function main() {
  const REF = process.argv[2] || "PRODUCTTESTANKORSTORE";

  // On scope au premier tenant trouve (env local a probablement 1 seul tenant)
  const tenant = await prisma.tenant.findFirst({});
  if (!tenant) throw new Error("Aucun tenant en BDD");
  console.log("Tenant utilise:", tenant.slug, tenant.name, tenant.id);

  await tenantALS.run(tenant.id, async () => {
    const p = await prisma.product.findFirst({
      where: {
        OR: [{ reference: { contains: REF } }, { name: { contains: REF } }],
      },
      select: {
        id: true,
        reference: true,
        name: true,
        status: true,
        ankorsProductId: true,
        ankorsSyncRequired: true,
        ankorsLastRefreshedAt: true,
        colors: {
          where: { saleType: "UNIT" },
          select: {
            id: true,
            disabled: true,
            stock: true,
            ankorsSku: true,
            ankorsVariantId: true,
            color: { select: { name: true } },
          },
        },
      },
    });

    if (!p) {
      console.log("Aucun produit trouve pour", REF);
      return;
    }

    console.log("=== PRODUIT BJ ===");
    console.log({
      id: p.id,
      reference: p.reference,
      name: p.name,
      status: p.status,
      ankorsProductId: p.ankorsProductId,
      ankorsSyncRequired: p.ankorsSyncRequired,
      lastRefreshed: p.ankorsLastRefreshedAt,
    });

    console.log("\n=== VARIANTES BJ (UNIT) ===");
    for (const c of p.colors) {
      console.log({
        id: c.id,
        color: c.color?.name,
        disabled: c.disabled,
        stock: c.stock,
        ankorsSku: c.ankorsSku,
        ankorsVariantId: c.ankorsVariantId,
      });
    }

    if (!p.ankorsProductId || !/^\d+$/.test(p.ankorsProductId)) {
      console.log("\nPas de lien Ankor int-format, on saute la lecture Ankor.");
      return;
    }

    console.log("\n=== LECTURE ANKOR (readProductById) ===");
    try {
      const ankor = await readProductById(Number(p.ankorsProductId));
      if (!ankor) {
        console.log(
          ">>> readProductById RENVOIE NULL — c'est probablement la source du bug."
        );
        console.log("    Motif possible : produit disabled/archive cote Ankor, ou ES stale.");
      } else {
        console.log({
          id: ankor.id,
          name: ankor.name,
          active: ankor.active,
          variantCount: ankor.variants?.length ?? 0,
        });
        for (const v of ankor.variants ?? []) {
          console.log(
            "  variant",
            {
              id: v.id,
              sku: v.sku,
              color: v.options?.find((o) => o.name === "color")?.value,
            }
          );
        }
      }
    } catch (err) {
      console.log("Erreur readProductById:", (err as Error).message);
    }

    // Cherche aussi par reference sur Ankor pour voir s'il y a d'autres
    // produits qui ont deja capture nos SKU
    console.log("\n=== RECHERCHE ANKOR (searchProducts ref) ===");
    try {
      const results = await searchProducts(p.reference, { limit: 5 });
      console.log(`${results.length} candidat(s) trouve(s) chez Ankor:`);
      for (const r of results) {
        console.log(`  #${r.id} — "${r.name}" — active=${r.active}`);
        for (const v of r.variants ?? []) {
          console.log(`     variant #${v.id} sku="${v.sku}"`);
        }
      }
    } catch (err) {
      console.log("Erreur searchProducts:", (err as Error).message);
    }
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
