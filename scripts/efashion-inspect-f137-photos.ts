/**
 * Diagnostic photos F137 — montre les images BJ par couleur et les photos
 * actuellement présentes côté eFashion pour chaque efashionProductId.
 *
 * Usage : npx tsx scripts/efashion-inspect-f137-photos.ts
 */

import { prisma } from "@/lib/prisma";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetProductPhotos } from "@/lib/efashion-photos";

const REFERENCE = "F137";

async function main() {
  const local = await prisma.product.findFirst({
    where: { reference: REFERENCE },
    select: {
      reference: true,
      efashionReferenceBase: true,
      colors: {
        select: {
          id: true,
          efashionProductId: true,
          color: { select: { name: true } },
          images: { select: { path: true, order: true }, orderBy: { order: "asc" } },
        },
        orderBy: { isPrimary: "desc" },
      },
    },
  });
  if (!local) {
    console.log(`❌ Aucun produit avec reference="${REFERENCE}" en BDD locale.`);
    process.exit(1);
  }

  console.log(`=== Photos F137 — BDD locale ===`);
  for (const c of local.colors) {
    console.log(`\nCouleur "${c.color?.name}" (efId=${c.efashionProductId ?? "null"}) :`);
    if (c.images.length === 0) {
      console.log(`  (aucune image en BDD)`);
    } else {
      for (const img of c.images) {
        console.log(`  order=${img.order}  path=${img.path}`);
      }
    }
  }

  console.log(`\n\n=== Photos F137 — côté eFashion (live) ===`);
  await ensureEfashionSession();
  for (const c of local.colors) {
    if (!c.efashionProductId) {
      console.log(`\nCouleur "${c.color?.name}" : pas d'efashionProductId → skip`);
      continue;
    }
    try {
      const res = await efashionGetProductPhotos(c.efashionProductId);
      console.log(`\nCouleur "${c.color?.name}" (efId=${c.efashionProductId}) :`);
      console.log(`  nbPhotos = ${res.nbPhotos}`);
      for (const p of res.photos) console.log(`  ${p}`);
    } catch (err) {
      console.log(
        `\nCouleur "${c.color?.name}" (efId=${c.efashionProductId}) : ❌ ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
