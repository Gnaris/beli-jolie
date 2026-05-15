/**
 * Passe en OFFLINE tous les produits actuellement ONLINE qui ont au moins
 * une couleur (variante) sans aucune image.
 *
 * Deux variantes UNIT et PACK de la même couleur partagent le même jeu
 * d'images : on utilise donc `findMissingImageCoverage` (même règle que la
 * validation du formulaire admin) pour grouper par couleur avant de décider.
 *
 * Usage :
 *   npx tsx scripts/offline-products-missing-images.ts            # exécution réelle
 *   npx tsx scripts/offline-products-missing-images.ts --dry-run  # simulation
 *
 * Le script affiche la liste des produits concernés avec les couleurs sans
 * image. Aucune action n'est faite sur PFS / Ankorstore (le statut côté
 * marketplaces n'est pas modifié).
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { findMissingImageCoverage } from "@/lib/variant-image-coverage";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const products = await prisma.product.findMany({
    where: { status: "ONLINE" },
    select: {
      id: true,
      reference: true,
      name: true,
      colors: {
        select: {
          id: true,
          colorId: true,
          color: { select: { name: true } },
        },
      },
    },
  });

  const productIds = products.map((p) => p.id);
  const imageCounts = await prisma.productColorImage.groupBy({
    by: ["productId", "colorId"],
    where: { productId: { in: productIds } },
    _count: { _all: true },
  });

  const imageCountByKey = new Map<string, number>();
  for (const row of imageCounts) {
    imageCountByKey.set(`${row.productId}::${row.colorId}`, row._count._all);
  }

  const toDowngrade: { id: string; reference: string; name: string; missing: string[] }[] = [];

  for (const product of products) {
    const missing = findMissingImageCoverage(
      product.colors.map((v) => ({
        id: v.id,
        colorId: v.colorId,
        colorName: v.color?.name ?? null,
        imageCount: v.colorId
          ? (imageCountByKey.get(`${product.id}::${v.colorId}`) ?? 0)
          : 0,
      })),
    );
    if (missing.length > 0) {
      toDowngrade.push({
        id: product.id,
        reference: product.reference,
        name: product.name,
        missing: missing.map((m) => m.label),
      });
    }
  }

  if (toDowngrade.length === 0) {
    console.log("Aucun produit ONLINE n'a de couleur sans image. Rien à faire.");
    return;
  }

  console.log(
    `${toDowngrade.length} produit(s) ONLINE concerné(s)${dryRun ? " (simulation, aucune modification)" : ""} :`,
  );
  for (const p of toDowngrade) {
    console.log(`  - ${p.reference} | ${p.name}  →  couleurs sans image : ${p.missing.join(", ")}`);
  }

  if (dryRun) {
    console.log("\nSimulation terminée. Relancez sans --dry-run pour appliquer.");
    return;
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: toDowngrade.map((p) => p.id) } },
    data: { status: "OFFLINE" },
  });

  console.log(`\n${result.count} produit(s) basculé(s) en OFFLINE.`);
  console.log("Pensez à redémarrer le site (pm2 restart beliandjolie) pour purger les caches publics.");
}

main()
  .catch((err) => {
    console.error("[Script] Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
