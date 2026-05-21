/**
 * Script — supprime la 1ʳᵉ photo (principale, suffixe `c`) de la couleur Moutarde
 * du produit test.
 *
 * Usage : npx tsx scripts/efashion-test-delete-photo.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import {
  efashionDeleteProductPhoto,
  efashionGetProductPhotos,
} from "@/lib/efashion-photos";

const ID_PRODUIT_MOUTARDE = 3665829;

async function main() {
  await ensureEfashionSession();
  console.log("→ Session eFashion OK\n");

  console.log(`→ Lecture des photos actuelles de Moutarde (id_produit ${ID_PRODUIT_MOUTARDE})`);
  const before = await efashionGetProductPhotos(ID_PRODUIT_MOUTARDE);
  console.log(`  ✓ ${before.nbPhotos} photo(s) :`);
  before.photos.forEach((p, i) => console.log(`     ${i + 1}. ${p}`));

  if (before.photos.length === 0) {
    console.log("\n⚠ Aucune photo à supprimer.");
    return;
  }

  // La 1ʳᵉ photo (principale) — suffixe `c`
  const firstPath = before.photos[0];
  const filename = firstPath.split("/").pop() ?? "";
  console.log(`\n→ Suppression de la 1ʳᵉ photo : ${filename}`);

  const result = await efashionDeleteProductPhoto({
    efashionProductId: ID_PRODUIT_MOUTARDE,
    filename,
  });
  console.log(`  ✓ Réponse : success=${result.success}  nbPhotos=${result.nbPhotos}`);

  console.log(`\n→ État après suppression :`);
  const after = await efashionGetProductPhotos(ID_PRODUIT_MOUTARDE);
  console.log(`  ✓ ${after.nbPhotos} photo(s) :`);
  after.photos.forEach((p, i) => console.log(`     ${i + 1}. ${p}`));

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`✅ 1ʳᵉ photo de Moutarde supprimée (${before.nbPhotos} → ${after.nbPhotos})`);
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
