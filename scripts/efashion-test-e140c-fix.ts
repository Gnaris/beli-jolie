/**
 * Test du fix : simule la nouvelle logique de sync (c.stock au lieu de vs.quantity)
 * et pousse les vraies valeurs sur eFashion pour E140C.
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionListProducts } from "@/lib/efashion-api";
import { efashionSaveProduitStocks } from "@/lib/efashion-api-write";
import { prisma } from "@/lib/prisma";

async function main() {
  await ensureEfashionSession();

  const product = await prisma.product.findFirst({
    where: { reference: "E140C" },
    select: {
      id: true,
      efashionReferenceBase: true,
      colors: {
        select: {
          stock: true,
          efashionProductId: true,
          color: { select: { name: true, efashionColorId: true } },
          variantSizes: { select: { size: { select: { name: true } } } },
        },
      },
    },
  });
  if (!product) throw new Error("E140C introuvable");

  console.log("→ Push avec la NOUVELLE logique (c.stock au lieu de vs.quantity) :\n");
  for (const c of product.colors) {
    if (!c.efashionProductId || !c.color?.efashionColorId) continue;
    const tailleLabel = c.variantSizes[0]?.size.name ?? "TU";
    const items = [
      {
        id_couleur: c.color.efashionColorId,
        value: c.stock,
        taille: tailleLabel === "TU" ? null : tailleLabel,
      },
    ];
    console.log(`  ${c.color.name} → id_produit=${c.efashionProductId}, value=${c.stock}, taille=${items[0].taille}`);
    await efashionSaveProduitStocks({ id_produit: c.efashionProductId, items });
  }

  console.log("\n→ Vérification après push :");
  const list = await efashionListProducts({
    idVendeur: 2017,
    reference: "E140C",
    premelFilter: "tous",
    take: 30,
  });
  for (const it of list.items.filter((it) => it.reference_base === "E140C")) {
    console.log(`  - id=${it.id_produit}  couleur=${it.couleur}  stock_value=${it.stock_value}  stock_renseigne=${it.stock_renseigne}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
