/**
 * Diagnostic — qu'est-ce qu'eFashion a vraiment enregistré pour notre produit test ?
 *
 * Usage : npx tsx scripts/efashion-test-inspect.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { efashionGetProductPhotos } from "@/lib/efashion-photos";

const TEST_REFERENCE = "TEST-EF-1779396051112";

async function main() {
  await ensureEfashionSession();
  const me = await efashionGetMe();
  console.log(`→ Vendeur : ${me.nomBoutique} (${me.id_vendeur})\n`);

  // On essaie d'abord avec filtre premel "tous" (en_ligne + brouillons + supprimés)
  // car notre produit est en brouillon (pas encore mis en ligne).
  for (const filter of ["tous", "brouillon", "en_ligne"] as const) {
    console.log(`→ Recherche reference="${TEST_REFERENCE}" premelFilter="${filter}"`);
    try {
      const res = await efashionListProducts({
        idVendeur: me.id_vendeur,
        take: 50,
        reference: TEST_REFERENCE,
        premelFilter: filter,
      });
      console.log(`  ✓ ${res.items.length} item(s), total=${res.total}`);
      for (const item of res.items) {
        console.log(`    - id_produit=${item.id_produit}  couleur=${item.couleur} (id ${item.id_couleur})  nb_photos=${item.nb_photos}  visible=${item.visible}  supprimer=${item.supprimer}  main=${item.main}`);
      }
      if (res.items.length > 0) break;
    } catch (err) {
      console.log(`  ⚠ Erreur : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Maintenant on interroge directement le endpoint photos pour les 2 productIds connus
  console.log("\n→ Inspection détaillée des photos par productId :");
  for (const id of [3665828, 3665829]) {
    try {
      const photos = await efashionGetProductPhotos(id);
      console.log(`  • ${id} → success=${photos.success}  nbPhotos=${photos.nbPhotos}`);
      photos.photos.forEach((p) => console.log(`      ${p}`));
    } catch (err) {
      console.log(`  • ${id} → ❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
