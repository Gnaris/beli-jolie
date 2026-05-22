/**
 * Migration ponctuelle — délier toutes les variantes PACK d'eFashion.
 *
 * Contexte : eFashion ne gère qu'1 ligne par couleur (pas de notion UNIT/PACK).
 * Historiquement, si une couleur BJ avait à la fois une variante UNIT et une
 * variante PACK, les DEUX ProductColor recevaient le même `efashionProductId`
 * au moment de la liaison manuelle — ce qui provoquait des doubles envois en
 * sync (le PACK écrasait le UNIT et inversement).
 *
 * Depuis le chantier "filtrage UNIT" (mai 2026) :
 *   - publish / update / refresh ignorent les variantes PACK
 *   - linkEfashionProductManually ne pose plus efashionProductId sur les PACK
 *
 * Ce script nettoie l'existant : il met `efashionProductId = null` sur toutes
 * les ProductColor PACK qui en avaient encore un (héritage de l'ancien code).
 * Idempotent — peut être relancé sans risque.
 *
 * Usage : `npx tsx scripts/efashion-unlink-pack-variants.ts`
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const toUnlink = await prisma.productColor.findMany({
    where: {
      saleType: "PACK",
      efashionProductId: { not: null },
    },
    select: {
      id: true,
      efashionProductId: true,
      productId: true,
      product: { select: { reference: true } },
      color: { select: { name: true } },
    },
  });

  if (toUnlink.length === 0) {
    console.log("Rien à délier — aucune variante PACK n'a d'efashionProductId.");
    return;
  }

  console.log(`${toUnlink.length} variante(s) PACK à délier :\n`);
  for (const pc of toUnlink) {
    console.log(
      `  • ${pc.product.reference} / ${pc.color?.name ?? "?"} ` +
        `(productColorId=${pc.id}, efashionProductId=${pc.efashionProductId})`,
    );
  }

  const result = await prisma.productColor.updateMany({
    where: {
      saleType: "PACK",
      efashionProductId: { not: null },
    },
    data: { efashionProductId: null },
  });

  console.log(`\n✅ ${result.count} variante(s) PACK déliée(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
