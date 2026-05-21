/**
 * Détecte tous les produits dont TOUTES les variantes ont stock=0 et qui ne sont
 * pas déjà archivés. Archive ces produits en local (status → ARCHIVED) et pousse
 * le statut "ARCHIVED" sur PFS pour ceux qui y sont publiés.
 *
 * Usage :
 *   npx tsx scripts/archive-out-of-stock.ts            # exécution réelle
 *   npx tsx scripts/archive-out-of-stock.ts --dry-run  # simulation
 *
 * Le script affiche la liste des produits concernés avant d'agir. Ankorstore
 * n'est PAS modifié par ce script (à traiter séparément si besoin).
 *
 * Script temporaire de rattrapage — à supprimer après usage.
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { pfsUpdateStatus } from "@/lib/pfs-api-write";

const PFS_BATCH_SIZE = 50;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const candidates = await prisma.product.findMany({
    where: { status: { not: "ARCHIVED" } },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      pfsProductId: true,
      colors: { select: { stock: true } },
    },
  });

  const toArchive = candidates.filter((p) => {
    if (p.colors.length === 0) return false;
    return p.colors.every((c) => c.stock === 0);
  });

  if (toArchive.length === 0) {
    console.log("Aucun produit en rupture totale à archiver. Rien à faire.");
    return;
  }

  const withPfs = toArchive.filter((p) => !!p.pfsProductId);
  const withoutPfs = toArchive.length - withPfs.length;

  console.log(
    `${toArchive.length} produit(s) en rupture totale à archiver${dryRun ? " (simulation)" : ""}.`,
  );
  console.log(`  • ${withPfs.length} avec lien PFS → statut ARCHIVED poussé sur PFS`);
  console.log(`  • ${withoutPfs} sans lien PFS → archivage local uniquement`);
  console.log();
  for (const p of toArchive) {
    const pfsTag = p.pfsProductId ? `PFS:${p.pfsProductId}` : "—";
    console.log(`  - ${p.reference} | ${p.name}  [${p.status} → ARCHIVED]  ${pfsTag}`);
  }

  if (dryRun) {
    console.log("\nSimulation terminée. Relancez sans --dry-run pour appliquer.");
    return;
  }

  // 1) Archivage local
  const result = await prisma.product.updateMany({
    where: { id: { in: toArchive.map((p) => p.id) } },
    data: { status: "ARCHIVED" },
  });
  console.log(`\n${result.count} produit(s) basculé(s) en ARCHIVED côté boutique.`);

  // 2) Push PFS par lots de 50
  if (withPfs.length === 0) {
    console.log("Aucun lien PFS à mettre à jour.");
  } else {
    let pfsOk = 0;
    let pfsFail = 0;
    for (let i = 0; i < withPfs.length; i += PFS_BATCH_SIZE) {
      const batch = withPfs.slice(i, i + PFS_BATCH_SIZE);
      try {
        await pfsUpdateStatus(
          batch.map((p) => ({ id: p.pfsProductId as string, status: "ARCHIVED" })),
        );
        pfsOk += batch.length;
        console.log(`  PFS OK : lot ${i / PFS_BATCH_SIZE + 1} (${batch.length} produits)`);
      } catch (err) {
        pfsFail += batch.length;
        console.error(
          `  PFS ÉCHEC lot ${i / PFS_BATCH_SIZE + 1} (${batch.length} produits) :`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(`\nPFS : ${pfsOk} succès, ${pfsFail} échecs (sur ${withPfs.length} produits liés).`);
  }

  console.log(
    "\nPensez à redémarrer le site (pm2 restart beliandjolie) pour purger les caches publics.",
  );
}

main()
  .catch((err) => {
    console.error("[Script] Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
