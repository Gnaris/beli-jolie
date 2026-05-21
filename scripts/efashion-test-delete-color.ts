/**
 * Script — supprime la couleur Turquoise (id_produit 3665828) du produit test.
 *
 * Chez eFashion, 1 couleur = 1 produit, donc on appelle
 * `POST /shootings/product/{id}/delete` sur le productId Turquoise.
 *
 * Usage : npx tsx scripts/efashion-test-delete-color.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionDeleteShootingProduct } from "@/lib/efashion-shootings";
import { efashionListProducts } from "@/lib/efashion-api";

const ID_PRODUIT_TURQUOISE = 3665828;
const REFERENCE = "TEST-EF-8WXZHW";

async function main() {
  await ensureEfashionSession();
  console.log("→ Session OK\n");

  // 1. État avant
  console.log("→ Couleurs AVANT suppression :");
  const before = await efashionListProducts({
    idVendeur: 2017,
    reference: REFERENCE,
    premelFilter: "tous",
    take: 20,
  });
  for (const it of before.items) {
    console.log(`   - id_produit=${it.id_produit}  couleur=${it.couleur}(${it.id_couleur})  main=${it.main}  nb_photos=${it.nb_photos}  supprimer=${it.supprimer}`);
  }

  // 2. Suppression
  console.log(`\n→ POST /shootings/product/${ID_PRODUIT_TURQUOISE}/delete`);
  const result = await efashionDeleteShootingProduct(ID_PRODUIT_TURQUOISE);
  console.log(`  ✓ Réponse : success=${result.success}  message=${result.message ?? "—"}`);

  // 3. État après — filtre "tous" pour voir si le produit a été flag "supprimer"
  console.log("\n→ Couleurs APRÈS (filtre tous, incluant les soft-deleted) :");
  const afterAll = await efashionListProducts({
    idVendeur: 2017,
    reference: REFERENCE,
    premelFilter: "tous",
    take: 20,
  });
  for (const it of afterAll.items) {
    console.log(`   - id_produit=${it.id_produit}  couleur=${it.couleur}(${it.id_couleur})  main=${it.main}  nb_photos=${it.nb_photos}  supprimer=${it.supprimer}`);
  }

  // 4. État après — filtre "brouillon" pour voir ce qui reste actif
  console.log("\n→ Couleurs APRÈS (filtre brouillon, ce qui est encore actif) :");
  const afterActive = await efashionListProducts({
    idVendeur: 2017,
    reference: REFERENCE,
    premelFilter: "brouillon",
    take: 20,
  });
  for (const it of afterActive.items) {
    console.log(`   - id_produit=${it.id_produit}  couleur=${it.couleur}(${it.id_couleur})  main=${it.main}  nb_photos=${it.nb_photos}  supprimer=${it.supprimer}`);
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("✅ Couleur Turquoise supprimée");
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
