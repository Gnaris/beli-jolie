/**
 * Script — sur le produit test, échange la 2ᵉ et la 3ᵉ photo de chaque couleur.
 *
 * Ordre actuel attendu  : c (1), z-1 (2), z-2 (3)
 * Ordre cible           : c (1), z-2 (2), z-1 (3)
 *
 * Usage : npx tsx scripts/efashion-test-swap-photos.ts
 */

import {
  efashionGetProductPhotos,
  efashionReorderProductPhotos,
} from "@/lib/efashion-photos";
import { ensureEfashionSession } from "@/lib/efashion-auth";

const TARGETS = [
  { label: "Turquoise", efashionProductId: 3665828 },
  { label: "Moutarde", efashionProductId: 3665829 },
];

/**
 * À partir d'un chemin "/uploads/products/.../3665828-z-1.jpg" extrait le
 * suffixe "z-1" (ou "c", ou "z-N").
 */
function suffixFromPath(p: string, productId: number): string {
  // Match "{productId}-{suffix}.jpg"
  const m = p.match(new RegExp(`${productId}-([^/.]+)\\.[a-zA-Z]+$`));
  return m ? m[1] : p;
}

async function main() {
  await ensureEfashionSession();
  console.log("→ Session eFashion OK\n");

  for (const target of TARGETS) {
    console.log(`→ ${target.label} (productId ${target.efashionProductId})`);

    const before = await efashionGetProductPhotos(target.efashionProductId);
    const beforeSuffixes = before.photos.map((p) =>
      suffixFromPath(p, target.efashionProductId),
    );
    console.log(`   Avant : [${beforeSuffixes.join(", ")}]  (${before.nbPhotos} photos)`);

    if (beforeSuffixes.length < 3) {
      console.log(`   ⚠ Moins de 3 photos — rien à swapper, on passe.`);
      continue;
    }

    // Cible : on garde la 1ʳᵉ (principale), on inverse 2ᵉ et 3ᵉ
    const newOrder = [
      beforeSuffixes[0],
      beforeSuffixes[2],
      beforeSuffixes[1],
      ...beforeSuffixes.slice(3),
    ];
    console.log(`   Cible : [${newOrder.join(", ")}]`);

    const result = await efashionReorderProductPhotos({
      efashionProductId: target.efashionProductId,
      positions: newOrder,
    });
    console.log(`   Réponse : success=${result.success}  nbPhotos=${result.nbPhotos}`);

    const after = await efashionGetProductPhotos(target.efashionProductId);
    const afterSuffixes = after.photos.map((p) =>
      suffixFromPath(p, target.efashionProductId),
    );
    console.log(`   Après : [${afterSuffixes.join(", ")}]`);
    after.photos.forEach((p) => console.log(`     ${p}`));
    console.log("");
  }

  console.log("════════════════════════════════════════════════════════════");
  console.log("✅ 2ᵉ et 3ᵉ photos échangées sur chaque couleur");
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
