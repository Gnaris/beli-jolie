/**
 * Supprime les images doublons créées par l'import PFS.
 *
 * Le bug : quand un produit avait plusieurs variantes (tailles) pour la même
 * couleur, les images étaient téléchargées une fois par variante au lieu d'une
 * fois par couleur. Ce script détecte les doublons (même colorId + même order)
 * et supprime les copies en gardant la première.
 *
 * Usage : npx tsx scripts/deduplicate-images.ts
 *         npx tsx scripts/deduplicate-images.ts --dry-run   (affiche sans supprimer)
 */

import { PrismaClient } from "@prisma/client";
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== Suppression des doublons ===");

  // Récupère toutes les images groupées par (productId, colorId, order)
  const allImages = await prisma.productColorImage.findMany({
    orderBy: [{ productId: "asc" }, { colorId: "asc" }, { order: "asc" }, { createdAt: "asc" }],
    select: { id: true, productId: true, colorId: true, order: true, path: true, createdAt: true },
  });

  // Grouper par (productId + colorId + order)
  const groups = new Map<string, typeof allImages>();
  for (const img of allImages) {
    const key = `${img.productId}|${img.colorId}|${img.order}`;
    const arr = groups.get(key) ?? [];
    arr.push(img);
    groups.set(key, arr);
  }

  let totalDuplicates = 0;
  let totalDeleted = 0;
  const affectedProducts = new Set<string>();

  for (const [key, imgs] of groups) {
    if (imgs.length <= 1) continue;

    // Garder le premier, supprimer le reste
    const [keep, ...duplicates] = imgs;
    totalDuplicates += duplicates.length;
    affectedProducts.add(keep.productId);

    console.log(
      `  Produit ${keep.productId} | couleur ${keep.colorId} | slot ${keep.order} : ` +
      `${imgs.length} images → garde 1, supprime ${duplicates.length}`
    );

    for (const dup of duplicates) {
      if (!dryRun) {
        // Supprimer le fichier du disque (large, medium, thumb)
        const basePath = dup.path.replace(/^\//, "");
        for (const suffix of ["", "_medium", "_thumb"]) {
          const withSuffix = basePath.replace(/(\.\w+)$/, `${suffix}$1`);
          const fullPath = join(process.cwd(), "public", withSuffix.replace(/^uploads\//, "uploads/"));
          const altPath = join(process.cwd(), withSuffix);
          for (const p of [fullPath, altPath]) {
            if (existsSync(p)) {
              try {
                await unlink(p);
                console.log(`    Fichier supprimé : ${p}`);
              } catch { /* ignore */ }
            }
          }
        }

        // Supprimer l'enregistrement en base
        await prisma.productColorImage.delete({ where: { id: dup.id } });
        totalDeleted++;
      }
    }
  }

  console.log("\n--- Résumé ---");
  console.log(`Produits concernés : ${affectedProducts.size}`);
  console.log(`Doublons trouvés : ${totalDuplicates}`);
  if (dryRun) {
    console.log("(dry-run : rien n'a été supprimé)");
  } else {
    console.log(`Enregistrements supprimés : ${totalDeleted}`);
  }
}

main()
  .catch((err) => {
    console.error("Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
