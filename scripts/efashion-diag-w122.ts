/**
 * Diagnostic ponctuel : que voit eFashion pour le groupe W122 ?
 *
 * Usage : npx tsx scripts/efashion-diag-w122.ts
 */

import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";

async function main() {
  const ref = "W122";

  const product = await prisma.product.findFirst({
    where: { efashionReferenceBase: ref },
    select: {
      id: true,
      reference: true,
      efashionReferenceBase: true,
      colors: {
        select: {
          id: true,
          efashionProductId: true,
          disabled: true,
          isPrimary: true,
          saleType: true,
          color: { select: { name: true, efashionColorId: true } },
        },
        orderBy: { isPrimary: "desc" },
      },
    },
  });
  if (!product) return;

  console.log(`\nProduit BJ ${product.reference}`);
  for (const pc of product.colors) {
    console.log(
      `  pc=${pc.id} | ${pc.saleType} | ef=${pc.efashionProductId} | ${pc.color?.name} (efColor=${pc.color?.efashionColorId})`,
    );
  }

  const me = await efashionGetMe();
  const items = await efashionListByReferenceBaseExact({
    idVendeur: me.id_vendeur,
    referenceBase: ref,
    premelFilter: "tous",
  });
  console.log(`\nlistByReferenceBaseExact('${ref}') → ${items.length} item(s) :`);
  for (const it of items) {
    console.log(
      `  ef=${it.id_produit} | ref=${it.reference} | ${it.couleur} (idColor=${(it as { id_couleur?: number }).id_couleur}) | main=${(it as { main?: boolean }).main} | visible=${(it as { visible?: boolean }).visible}`,
    );
  }

  const liveIds = new Set(items.map((it) => it.id_produit));
  const bjLinkedIds = product.colors
    .map((c) => c.efashionProductId)
    .filter((id): id is number => id !== null);
  const missing = bjLinkedIds.filter((id) => !liveIds.has(id));
  console.log(`\nIDs BJ liés : [${bjLinkedIds.join(", ")}]`);
  console.log(`IDs absents d'eFashion : [${missing.join(", ") || "aucun"}]`);

  // Images de chaque couleur locale.
  const allImages = await prisma.productColorImage.findMany({
    where: { productId: product.id },
    select: { colorId: true, path: true, order: true },
    orderBy: { order: "asc" },
  });
  const byColor = new Map<string, number>();
  for (const i of allImages) byColor.set(i.colorId, (byColor.get(i.colorId) ?? 0) + 1);
  console.log("\nImages locales par couleur :");
  for (const pc of product.colors) {
    if (!pc.colorId) continue;
    const n = byColor.get(pc.colorId) ?? 0;
    console.log(`  ${pc.color?.name} → ${n} image(s)`);
  }
}

main()
  .catch((err) => console.error(err))
  .finally(() => prisma.$disconnect());
