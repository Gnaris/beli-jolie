/**
 * Réparation ponctuelle W122 : supprime côté eFashion les 2 couleurs qui
 * étaient dans un shooting séparé (Noir 3705719, Turquoise 3705720), créées
 * par l'ancien `duplicateWithNewColor`. Nettoie ensuite les efashionProductId
 * locaux pour que le prochain « Sauvegarder » de la cliente recrée les
 * couleurs proprement via le nouveau flow PUT shooting.
 *
 * Usage : npx tsx scripts/efashion-fix-w122.ts
 */
import { prisma } from "@/lib/prisma";
import { efashionSoftDeleteProduits } from "@/lib/efashion-api-write";
import { logger } from "@/lib/logger";

const ORPHANED_IDS = [3705719, 3705720];

async function main() {
  logger.info("[fix W122] softDelete des couleurs orphelines (shooting séparé)", {
    ids: ORPHANED_IDS,
  });

  try {
    await efashionSoftDeleteProduits(ORPHANED_IDS);
    logger.info("[fix W122] softDelete OK");
  } catch (err) {
    logger.error("[fix W122] softDelete KO — on continue malgré tout pour nettoyer la BDD", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const res = await prisma.productColor.updateMany({
    where: {
      productId: "cmozne17l0gmlekvdtce1vla8",
      efashionProductId: { in: ORPHANED_IDS },
    },
    data: { efashionProductId: null },
  });

  logger.info("[fix W122] efashionProductId nettoyés en BDD locale", {
    count: res.count,
  });

  console.log(
    `\n✔ Réparation W122 OK : ${res.count} ProductColor(s) déliées. ` +
      `Cliquer "Sauvegarder" sur la fiche W122 pour recréer Noir + Turquoise via PUT shooting.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
