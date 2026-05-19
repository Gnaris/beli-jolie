/**
 * Convertit les produits dont TOUTES les variantes sont :
 *   - en mode PACK (saleType = "PACK")
 *   - avec packQuantity = 1
 *   - une seule taille, nommée exactement "Taille unique"
 *   - sans aucune ligne de pack multi-couleurs (packLines vide)
 *
 * Ces variantes sont basculées en UNIT (packQuantity = null) en conservant
 * la taille "Taille unique", le prix et le stock tels quels.
 *
 * Si un produit a au moins une variante qui ne remplit pas TOUTES ces
 * conditions, le produit entier est ignore (aucune de ses variantes n'est
 * modifiee).
 *
 * Ne touche PAS aux identifiants marketplace (pfsVariantId / ankorsVariantId)
 * ni au snapshot pfsLastSyncSnapshot. PFS et Ankorstore ne sont pas appeles.
 *
 * Usage :
 *   npx tsx scripts/convert-single-pack-to-unit.ts             # simulation (dry-run)
 *   npx tsx scripts/convert-single-pack-to-unit.ts --apply     # execution reelle
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const TAILLE_UNIQUE_NAME = "Taille unique";

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  const mode = apply ? "EXECUTION" : "SIMULATION (dry-run)";
  console.log(`\n=== ${mode} ===`);
  console.log("Recherche des produits eligibles...\n");

  const products = await prisma.product.findMany({
    select: {
      id: true,
      reference: true,
      name: true,
      colors: {
        select: {
          id: true,
          saleType: true,
          packQuantity: true,
          variantSizes: {
            select: {
              id: true,
              size: { select: { name: true } },
            },
          },
          packLines: { select: { id: true } },
        },
      },
    },
  });

  const eligible: Array<{
    productId: string;
    reference: string;
    name: string;
    variantIds: string[];
    variantSizeIds: string[];
  }> = [];

  for (const p of products) {
    if (p.colors.length === 0) continue;

    const allMatch = p.colors.every((c) => {
      if (c.saleType !== "PACK") return false;
      if (c.packQuantity !== 1) return false;
      if (c.packLines.length > 0) return false;
      if (c.variantSizes.length !== 1) return false;
      const onlySize = c.variantSizes[0];
      return onlySize.size?.name === TAILLE_UNIQUE_NAME;
    });

    if (!allMatch) continue;

    eligible.push({
      productId: p.id,
      reference: p.reference,
      name: p.name,
      variantIds: p.colors.map((c) => c.id),
      variantSizeIds: p.colors.flatMap((c) => c.variantSizes.map((s) => s.id)),
    });
  }

  const totalProducts = eligible.length;
  const totalVariants = eligible.reduce((sum, e) => sum + e.variantIds.length, 0);

  console.log(`Produits eligibles : ${totalProducts}`);
  console.log(`Variantes a convertir : ${totalVariants}\n`);

  if (totalProducts === 0) {
    console.log("Rien a faire. Fin.");
    await prisma.$disconnect();
    return;
  }

  console.log("Liste des produits :");
  for (const e of eligible) {
    console.log(`  - [${e.reference}] ${e.name}  (${e.variantIds.length} variante(s))`);
  }
  console.log("");

  if (!apply) {
    console.log("Mode simulation : aucun changement n'a ete applique.");
    console.log("Relancer avec --apply pour executer la conversion.\n");
    await prisma.$disconnect();
    return;
  }

  console.log("Application des modifications...");
  let convertedVariants = 0;
  let convertedProducts = 0;

  for (const e of eligible) {
    await prisma.$transaction(async (tx) => {
      const res = await tx.productColor.updateMany({
        where: { id: { in: e.variantIds } },
        data: { saleType: "UNIT", packQuantity: null },
      });
      convertedVariants += res.count;

      // pricePerUnit n'a de sens qu'en PACK ; on le remet a null pour les
      // VariantSize concernees (la taille "Taille unique" reste, c'est juste
      // une remise a zero du champ qui n'est plus utilise).
      if (e.variantSizeIds.length > 0) {
        await tx.variantSize.updateMany({
          where: { id: { in: e.variantSizeIds } },
          data: { pricePerUnit: null },
        });
      }
    });
    convertedProducts += 1;
  }

  console.log(`\nProduits convertis : ${convertedProducts}`);
  console.log(`Variantes converties : ${convertedVariants}\n`);
  console.log("Termine.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Erreur :", err);
  process.exit(1);
});
