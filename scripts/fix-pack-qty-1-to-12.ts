/**
 * Rattrapage ponctuel : pour tous les produits en brouillon (OFFLINE) qui ont
 * une (ou plusieurs) variante de type PACK avec packQuantity = 1, on remonte
 * la quantité à 12. La cliente a oublié de remplir la colonne « Qté pack »
 * dans plusieurs Excel d'import, ce qui faisait retomber le défaut à 1.
 *
 * Pour rester cohérent côté stock, on met aussi à jour la VariantSize associée
 * si elle est unique (une seule taille avec quantity = 1). Si plusieurs
 * VariantSize sont rattachées ou si la quantité n'est pas 1, on ne touche pas
 * (cas non standard — la cliente devra corriger à la main).
 *
 * IMPORTANT : on NE touche PAS au unitPrice. La cliente saisit ses prix au
 * niveau du paquet — ils restent valides après changement de packQuantity.
 *
 * Usage :
 *   - Dry-run (par défaut) : npx tsx scripts/fix-pack-qty-1-to-12.ts
 *   - Application réelle    : npx tsx scripts/fix-pack-qty-1-to-12.ts --apply
 */

import { prisma } from "@/lib/prisma";

const NEW_PACK_QTY = 12;

async function main() {
  const apply = process.argv.includes("--apply");

  console.log(`Mode : ${apply ? "APPLICATION RÉELLE" : "dry-run (passez --apply pour écrire)"}`);
  console.log(`Cible : ProductColor saleType=PACK, packQuantity=1, product.status=OFFLINE`);
  console.log(`Nouvelle valeur : packQuantity = ${NEW_PACK_QTY}\n`);

  // ── Récupérer les variantes cibles + leurs VariantSize ──
  const targets = await prisma.productColor.findMany({
    where: {
      saleType: "PACK",
      packQuantity: 1,
      product: { status: "OFFLINE" },
    },
    select: {
      id: true,
      packQuantity: true,
      product: { select: { reference: true, name: true } },
      color: { select: { name: true } },
      variantSizes: { select: { id: true, quantity: true, size: { select: { name: true } } } },
    },
  });

  console.log(`Trouvé : ${targets.length} variante(s) PACK à corriger.\n`);

  if (targets.length === 0) {
    console.log("Rien à faire.");
    return;
  }

  let updated = 0;
  let sizeUpdated = 0;
  let skippedComplex = 0;
  const skippedSamples: string[] = [];

  for (const t of targets) {
    const ref = t.product.reference;
    const color = t.color.name;
    const sizeInfo = t.variantSizes.map((vs) => `${vs.size.name}=${vs.quantity}`).join(", ");

    // Cas standard : une seule VariantSize avec quantity = 1
    const isStandardCase =
      t.variantSizes.length === 1 && t.variantSizes[0].quantity === 1;

    if (apply) {
      await prisma.productColor.update({
        where: { id: t.id },
        data: { packQuantity: NEW_PACK_QTY },
      });
      updated++;

      if (isStandardCase) {
        await prisma.variantSize.update({
          where: { id: t.variantSizes[0].id },
          data: { quantity: NEW_PACK_QTY },
        });
        sizeUpdated++;
      } else {
        skippedComplex++;
        if (skippedSamples.length < 10) {
          skippedSamples.push(`${ref} / ${color} → tailles : [${sizeInfo}]`);
        }
      }
    } else {
      // Dry-run : on affiche ce qu'on ferait
      const action = isStandardCase
        ? `pack ${NEW_PACK_QTY} + taille ${t.variantSizes[0].size.name} ${NEW_PACK_QTY}`
        : `pack ${NEW_PACK_QTY} (tailles non standardes laissées telles quelles : [${sizeInfo}])`;
      console.log(`  ${ref} / ${color} → ${action}`);
      updated++;
      if (isStandardCase) sizeUpdated++;
      else {
        skippedComplex++;
        if (skippedSamples.length < 10) {
          skippedSamples.push(`${ref} / ${color} → tailles : [${sizeInfo}]`);
        }
      }
    }
  }

  console.log(`\n──────── Résumé ────────`);
  console.log(`packQuantity 1 → ${NEW_PACK_QTY} : ${updated} variante(s)`);
  console.log(`VariantSize 1 → ${NEW_PACK_QTY} : ${sizeUpdated} taille(s) (cas standard)`);
  if (skippedComplex > 0) {
    console.log(`Tailles non touchées (cas non standard) : ${skippedComplex}`);
    console.log(`Exemples :`);
    skippedSamples.forEach((s) => console.log(`  - ${s}`));
    console.log(`(à corriger manuellement dans l'admin si besoin)`);
  }
  if (!apply) {
    console.log(`\n⚠ Dry-run : aucune écriture en BDD. Relancez avec --apply pour appliquer.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
