/**
 * Fusionne les éventuelles tailles « TU » créées par l'import PFS dans la
 * taille protégée « Taille unique ».
 *
 * Étapes :
 *   1. Trouve la taille protégée (« Taille unique »).
 *      - Si elle n'existe pas, on la crée avec pfsSizeRef = "TU".
 *      - Si elle existe sans pfsSizeRef, on la complète.
 *   2. Pour chaque autre taille dont le nom est "TU" ou "tu", déplace toutes
 *      les VariantSize / PackColorLineSize qui la référencent vers la taille
 *      protégée, puis supprime la ligne en double.
 *   3. Affiche un récapitulatif.
 *
 * Usage : npx tsx scripts/merge-tu-into-taille-unique.ts
 */
import { prisma } from "@/lib/prisma";
import {
  PROTECTED_SIZE_NAME,
  PROTECTED_SIZE_PFS_REF,
} from "@/lib/protected-sizes";

async function main() {
  console.log("=== Fusion des tailles TU dans « Taille unique » ===\n");

  // 1. Taille protégée
  let protectedSize = await prisma.size.findFirst({
    where: { name: PROTECTED_SIZE_NAME },
    select: { id: true, name: true, pfsSizeRef: true },
  });

  if (!protectedSize) {
    protectedSize = await prisma.size.create({
      data: { name: PROTECTED_SIZE_NAME, pfsSizeRef: PROTECTED_SIZE_PFS_REF, position: 0 },
      select: { id: true, name: true, pfsSizeRef: true },
    });
    console.log(`✅ Taille protégée créée : ${protectedSize.id}`);
  } else if (!protectedSize.pfsSizeRef) {
    await prisma.size.update({
      where: { id: protectedSize.id },
      data: { pfsSizeRef: PROTECTED_SIZE_PFS_REF },
    });
    console.log(`✅ pfsSizeRef « TU » ajouté à la taille protégée existante (${protectedSize.id})`);
  } else {
    console.log(`✅ Taille protégée déjà OK : ${protectedSize.id} (pfsSizeRef=${protectedSize.pfsSizeRef})`);
  }

  // 2. Doublons à fusionner
  const duplicates = await prisma.size.findMany({
    where: {
      AND: [
        { id: { not: protectedSize.id } },
        { OR: [{ name: "TU" }, { name: "tu" }, { pfsSizeRef: "TU" }] },
      ],
    },
    select: { id: true, name: true, pfsSizeRef: true },
  });

  if (duplicates.length === 0) {
    console.log("\nAucun doublon trouvé. Rien à fusionner.");
    return;
  }

  console.log(`\n${duplicates.length} doublon(s) à fusionner :`);
  duplicates.forEach((d) => console.log(`  - ${d.id} (name=${d.name}, pfsSizeRef=${d.pfsSizeRef})`));

  let totalVariantSizes = 0;
  let totalPackColorLineSizes = 0;
  let totalDeleted = 0;

  for (const dup of duplicates) {
    // Avant de réassigner, on vérifie qu'il n'y a pas déjà un VariantSize
    // (productColorId, sizeId=protectedSize.id) qui collisionne avec ceux du
    // doublon. Si c'est le cas, on additionne les quantités et on supprime la
    // ligne du doublon plutôt que d'écraser la contrainte unique.
    const dupVariantSizes = await prisma.variantSize.findMany({
      where: { sizeId: dup.id },
      select: { id: true, productColorId: true, quantity: true },
    });

    for (const vs of dupVariantSizes) {
      const existing = await prisma.variantSize.findUnique({
        where: { productColorId_sizeId: { productColorId: vs.productColorId, sizeId: protectedSize.id } },
        select: { id: true, quantity: true },
      });
      if (existing) {
        await prisma.variantSize.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + vs.quantity },
        });
        await prisma.variantSize.delete({ where: { id: vs.id } });
      } else {
        await prisma.variantSize.update({
          where: { id: vs.id },
          data: { sizeId: protectedSize.id },
        });
      }
      totalVariantSizes++;
    }

    // Idem pour PackColorLineSize
    const dupPackSizes = await prisma.packColorLineSize.findMany({
      where: { sizeId: dup.id },
      select: { id: true, packColorLineId: true, quantity: true },
    });

    for (const ps of dupPackSizes) {
      const existing = await prisma.packColorLineSize.findUnique({
        where: { packColorLineId_sizeId: { packColorLineId: ps.packColorLineId, sizeId: protectedSize.id } },
        select: { id: true, quantity: true },
      });
      if (existing) {
        await prisma.packColorLineSize.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + ps.quantity },
        });
        await prisma.packColorLineSize.delete({ where: { id: ps.id } });
      } else {
        await prisma.packColorLineSize.update({
          where: { id: ps.id },
          data: { sizeId: protectedSize.id },
        });
      }
      totalPackColorLineSizes++;
    }

    // Suppression du doublon (toutes ses références ont été migrées)
    await prisma.size.delete({ where: { id: dup.id } });
    totalDeleted++;
  }

  console.log(`\n=== Bilan ===`);
  console.log(`  ${totalVariantSizes} variante(s) déplacée(s)`);
  console.log(`  ${totalPackColorLineSizes} ligne(s) de pack déplacée(s)`);
  console.log(`  ${totalDeleted} doublon(s) supprimé(s)`);
  console.log(`Toutes les références TU pointent maintenant vers la taille protégée ${protectedSize.id}.`);
}

main()
  .catch((e) => {
    console.error("Erreur :", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
