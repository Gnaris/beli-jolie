/**
 * Test bout-en-bout : lance une resync forcée sur F137 et vérifie que les
 * photos arrivent côté eFashion.
 *
 * Usage : npx tsx scripts/efashion-test-f137-images-sync.ts
 */
import { prisma } from "@/lib/prisma";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetProductPhotos } from "@/lib/efashion-photos";

async function main() {
  const product = await prisma.product.findFirst({
    where: { reference: "F137" },
    select: {
      id: true,
      colors: {
        select: { efashionProductId: true, color: { select: { name: true } } },
      },
    },
  });
  if (!product) throw new Error("F137 introuvable");

  console.log("=== AVANT sync ===");
  await ensureEfashionSession();
  for (const c of product.colors) {
    if (!c.efashionProductId) continue;
    const res = await efashionGetProductPhotos(c.efashionProductId);
    console.log(`  ${c.color?.name} (efId=${c.efashionProductId}) : ${res.nbPhotos} photo(s)`);
  }

  console.log("\n=== Lancement de la resync (forceFullSync=true) ===");
  const result = await efashionUpdateProductInPlace(product.id, { forceFullSync: true });
  console.log("Résultat :", JSON.stringify(result, null, 2));

  console.log("\n=== APRÈS sync ===");
  for (const c of product.colors) {
    if (!c.efashionProductId) continue;
    const res = await efashionGetProductPhotos(c.efashionProductId);
    console.log(`  ${c.color?.name} (efId=${c.efashionProductId}) : ${res.nbPhotos} photo(s)`);
    for (const p of res.photos) console.log(`    ${p}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
