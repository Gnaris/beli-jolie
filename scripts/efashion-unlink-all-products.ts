/**
 * Délie TOUS les produits BJ d'eFashion côté BDD locale uniquement.
 *
 * Ne touche RIEN côté eFashion — les produits-couleurs restent intacts chez eux.
 * Reset uniquement les champs locaux :
 *   - Product.efashionReferenceBase = null
 *   - Product.efashionLastSyncSnapshot = null
 *   - Product.efashionLastRefreshedAt = null
 *   - ProductColor.efashionProductId = null
 *
 * Sert à repartir d'une page blanche pour retester le flux de liaison.
 *
 * Usage : `npx tsx scripts/efashion-unlink-all-products.ts`
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function main() {
  const linkedProducts = await prisma.product.count({
    where: { efashionReferenceBase: { not: null } },
  });
  const linkedVariants = await prisma.productColor.count({
    where: { efashionProductId: { not: null } },
  });

  console.log(
    `État avant : ${linkedProducts} produit(s) lié(s) · ${linkedVariants} variante(s) avec efashionProductId\n`,
  );

  if (linkedProducts === 0 && linkedVariants === 0) {
    console.log("Rien à délier — la base est déjà propre.");
    return;
  }

  // Transaction pour garder les deux côtés cohérents
  await prisma.$transaction([
    prisma.product.updateMany({
      where: { efashionReferenceBase: { not: null } },
      data: {
        efashionReferenceBase: null,
        efashionLastSyncSnapshot: Prisma.DbNull,
        efashionLastRefreshedAt: null,
      },
    }),
    prisma.productColor.updateMany({
      where: { efashionProductId: { not: null } },
      data: { efashionProductId: null },
    }),
  ]);

  const remainingProducts = await prisma.product.count({
    where: { efashionReferenceBase: { not: null } },
  });
  const remainingVariants = await prisma.productColor.count({
    where: { efashionProductId: { not: null } },
  });

  console.log(
    `✅ Terminé. État après : ${remainingProducts} produit(s) lié(s) · ${remainingVariants} variante(s) avec efashionProductId`,
  );
  console.log(
    `\nNote : les produits côté eFashion sont intacts. ` +
      `Vous pouvez ré-ouvrir la modale "Lier à eFashion" pour retester le flux.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
