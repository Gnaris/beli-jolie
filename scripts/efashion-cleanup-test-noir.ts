/**
 * Nettoyage one-shot : supprime la couleur eFashion 3729294 (W122-NOIR
 * créée pendant le diagnostic du 29/06/2026, restée en brouillon sans
 * photo), et détache toute ProductColor BJ qui pointerait dessus.
 *
 * Après ce script : si la cliente veut Noir au catalogue, elle ajoute
 * Noir + une photo localement dans W122 et clique Sauvegarder — le
 * nouveau code (duplicateWithNewColor + upload + publishBrouillon)
 * créera la fiche proprement.
 *
 * Usage : npx tsx scripts/efashion-cleanup-test-noir.ts
 */

import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";
import { efashionSoftDeleteProduits } from "@/lib/efashion-api-write";

const EF_TO_DELETE = 3729294;

async function main() {
  console.log(`\n=== Nettoyage couleur test eFashion id=${EF_TO_DELETE} ===\n`);

  const vendor = await efashionGetMe();
  console.log(`🔌 Vendeur : ${vendor.nomBoutique} (id_vendeur=${vendor.id_vendeur})\n`);

  // 1. État BDD locale : qui pointe vers 3729294 ?
  const linkedBJ = await prisma.productColor.findMany({
    where: { efashionProductId: EF_TO_DELETE },
    select: {
      id: true,
      product: { select: { id: true, reference: true } },
      color: { select: { name: true } },
    },
  });
  console.log(`Couleurs BJ pointant vers ${EF_TO_DELETE} : ${linkedBJ.length}`);
  for (const c of linkedBJ) {
    console.log(`  - ProductColor id=${c.id} produit=${c.product?.reference} couleur=${c.color?.name}`);
  }

  // 2. État live chez eFashion
  const live = await efashionListByReferenceBaseExact({
    idVendeur: vendor.id_vendeur,
    referenceBase: "W122",
    premelFilter: "tous",
  });
  const target = live.find((v) => v.id_produit === EF_TO_DELETE);
  console.log(`\nÉtat live ${EF_TO_DELETE} chez eFashion :`, target ? {
    id: target.id_produit,
    ref: target.reference,
    couleur: target.couleur,
    visible: target.visible,
    nb_photos: target.nb_photos,
    id_shooting: target.id_shooting,
  } : "INTROUVABLE (peut-être déjà supprimée)");

  if (!target) {
    console.log("\n→ Rien à supprimer côté eFashion.");
  } else {
    // 3. Suppression chez eFashion via le batch soft-delete (utilisé partout
    // ailleurs dans le code pour les suppressions de variantes).
    console.log(`\nSuppression eFashion de ${EF_TO_DELETE}...`);
    await efashionSoftDeleteProduits([EF_TO_DELETE]);
    console.log("✅ Supprimé chez eFashion.");
  }

  // 4. Détache toute ProductColor BJ qui pointait dessus
  if (linkedBJ.length > 0) {
    const upd = await prisma.productColor.updateMany({
      where: { efashionProductId: EF_TO_DELETE },
      data: { efashionProductId: null },
    });
    console.log(`✅ ${upd.count} ProductColor détachée(s) en BDD locale.`);
  }

  console.log("\n=== Fin ===\n");
}

main()
  .catch((err) => {
    console.error("Erreur fatale :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
