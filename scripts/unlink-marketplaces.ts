/**
 * Délie TOUS les produits (et leurs variantes) des marketplaces PFS,
 * Ankorstore et eFashion dans la BDD locale. Ne touche pas aux marketplaces
 * elles-mêmes — c'est purement un reset des références côté BDD locale.
 *
 * Reset :
 *   Product.pfsProductId / ankorsProductId / efashionReferenceBase  → null
 *   Product.pfsLastSyncSnapshot / ankorsLastSyncSnapshot / efashionLastSyncSnapshot → null
 *   Product.pfsSyncRequired / ankorsSyncRequired / efashionSyncRequired → false
 *   ProductColor.pfsVariantId / ankorsVariantId / efashionProductId → null
 *
 * Usage :
 *   npx tsx scripts/unlink-marketplaces.ts
 *
 * Aucune confirmation interactive : la commande s'exécute immédiatement.
 */

import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = {
    pfsProducts: await prisma.product.count({ where: { pfsProductId: { not: null } } }),
    ankorsProducts: await prisma.product.count({ where: { ankorsProductId: { not: null } } }),
    efashionProducts: await prisma.product.count({ where: { efashionReferenceBase: { not: null } } }),
    pfsVariants: await prisma.productColor.count({ where: { pfsVariantId: { not: null } } }),
    ankorsVariants: await prisma.productColor.count({ where: { ankorsVariantId: { not: null } } }),
    efashionVariants: await prisma.productColor.count({ where: { efashionProductId: { not: null } } }),
  };

  console.log("État avant :");
  console.log(`  PFS         : ${before.pfsProducts} produits, ${before.pfsVariants} variantes`);
  console.log(`  Ankorstore  : ${before.ankorsProducts} produits, ${before.ankorsVariants} variantes`);
  console.log(`  eFashion    : ${before.efashionProducts} produits, ${before.efashionVariants} variantes`);

  await prisma.$transaction([
    prisma.product.updateMany({
      data: {
        pfsProductId: null,
        ankorsProductId: null,
        efashionReferenceBase: null,
        pfsLastSyncSnapshot: Prisma.DbNull,
        ankorsLastSyncSnapshot: Prisma.DbNull,
        efashionLastSyncSnapshot: Prisma.DbNull,
        pfsSyncRequired: false,
        ankorsSyncRequired: false,
        efashionSyncRequired: false,
      },
    }),
    prisma.productColor.updateMany({
      data: {
        pfsVariantId: null,
        ankorsVariantId: null,
        efashionProductId: null,
      },
    }),
  ]);

  const after = {
    pfsProducts: await prisma.product.count({ where: { pfsProductId: { not: null } } }),
    ankorsProducts: await prisma.product.count({ where: { ankorsProductId: { not: null } } }),
    efashionProducts: await prisma.product.count({ where: { efashionReferenceBase: { not: null } } }),
    pfsVariants: await prisma.productColor.count({ where: { pfsVariantId: { not: null } } }),
    ankorsVariants: await prisma.productColor.count({ where: { ankorsVariantId: { not: null } } }),
    efashionVariants: await prisma.productColor.count({ where: { efashionProductId: { not: null } } }),
  };

  console.log("État après :");
  console.log(`  PFS         : ${after.pfsProducts} produits, ${after.pfsVariants} variantes`);
  console.log(`  Ankorstore  : ${after.ankorsProducts} produits, ${after.ankorsVariants} variantes`);
  console.log(`  eFashion    : ${after.efashionProducts} produits, ${after.efashionVariants} variantes`);
  console.log("Terminé.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
