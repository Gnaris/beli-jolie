/**
 * Délie TOUS les produits BJ de leur lien Ankorstore (côté BJ uniquement).
 *
 * Ne touche PAS aux produits chez Ankor — ils restent en ligne.
 * On casse simplement le lien local (ankorsProductId + ankorsVariantId) pour
 * pouvoir tout relier proprement via le nouveau flow back-office, en écrasant
 * les SKU legacy au format `A1720_DORE_CLAIR`.
 *
 * Usage : npx tsx scripts/ankorstore-unlink-all.ts [--tenant=cmXXX] [--dry-run]
 *
 * Options :
 *   --tenant=<tid> : ne délier que le tenant spécifié (défaut : tous)
 *   --dry-run      : affiche ce qui serait délié sans rien modifier
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const args = process.argv.slice(2);
  const tenantArg = args.find((a) => a.startsWith("--tenant="))?.split("=")[1];
  const dryRun = args.includes("--dry-run");

  process.env.MULTI_TENANT_SCOPE = "off";

  const products = await prisma.product.findMany({
    where: {
      ankorsProductId: { not: null },
      ...(tenantArg ? { tenantId: tenantArg } : {}),
    },
    select: {
      id: true,
      reference: true,
      tenantId: true,
      ankorsProductId: true,
    },
  });
  const productColors = await prisma.productColor.findMany({
    where: {
      ankorsVariantId: { not: null },
      ...(tenantArg ? { product: { tenantId: tenantArg } } : {}),
    },
    select: { id: true, ankorsVariantId: true, productId: true },
  });

  console.log("");
  console.log("=".repeat(72));
  console.log("  Délier tous les produits BJ d'Ankorstore (côté BJ uniquement)");
  console.log("=".repeat(72));
  console.log(`  Mode                 : ${dryRun ? "DRY-RUN (aucune écriture)" : "RÉEL"}`);
  console.log(`  Tenant               : ${tenantArg ?? "tous"}`);
  console.log(`  Produits liés        : ${products.length}`);
  console.log(`  Variantes liées      : ${productColors.length}`);
  console.log("");

  if (products.length === 0) {
    console.log("Aucun produit à délier. Rien à faire.");
    return;
  }

  const byFormat = {
    int: products.filter((p) => /^\d+$/.test(p.ankorsProductId ?? "")).length,
    uuid: products.filter((p) => !/^\d+$/.test(p.ankorsProductId ?? "")).length,
  };
  console.log(`  Dont IDs numériques (back-office) : ${byFormat.int}`);
  console.log(`  Dont IDs UUID (legacy OAuth2)     : ${byFormat.uuid}`);
  console.log("");

  if (dryRun) {
    console.log("→ DRY-RUN, arrêt sans modification.");
    return;
  }

  const productIds = products.map((p) => p.id);
  const colorIds = productColors.map((c) => c.id);

  const r1 = await prisma.product.updateMany({
    where: { id: { in: productIds } },
    data: { ankorsProductId: null, ankorsSyncRequired: false, ankorsLastSyncSnapshot: undefined },
  });
  const r2 = await prisma.productColor.updateMany({
    where: { id: { in: colorIds } },
    data: { ankorsVariantId: null },
  });

  console.log(`✅ ${r1.count} produits déliés`);
  console.log(`✅ ${r2.count} variantes déliées`);
  console.log("");
  console.log("→ Tu peux maintenant utiliser le bouton « Lier à Ankorstore » sur chaque produit");
  console.log("  pour recréer les liens proprement au nouveau format.");
}

main()
  .catch((err) => {
    console.error("\n❌ Erreur :", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
