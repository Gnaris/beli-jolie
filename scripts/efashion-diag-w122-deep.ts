/**
 * Diagnostic profond pour la couleur Turquoise W122 (id_produit 3705720).
 * Lit l'état complet côté eFashion : photos, premel, etc.
 */
import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { efashionGetProductPhotos } from "@/lib/efashion-photos";

async function main() {
  const me = await efashionGetMe();

  // Liste TOUTES les variantes W122 avec leur état complet brut
  const r = await efashionListProducts({
    idVendeur: me.id_vendeur,
    take: 50,
    skip: 0,
    reference: "W122",
    premelFilter: "tous",
  });
  console.log(`\n${r.items.length} item(s) bruts :`);
  for (const it of r.items) {
    if ((it.reference_base ?? "").toLowerCase() !== "w122") continue;
    console.log("─".repeat(60));
    console.log(JSON.stringify(it, null, 2));
  }

  // Photos détaillées pour 3705720 (Turquoise)
  console.log("\n\n── Photos Turquoise (3705720) ──");
  try {
    const photos = await efashionGetProductPhotos(3705720);
    console.log(JSON.stringify(photos, null, 2));
  } catch (err) {
    console.error("getProductPhotos KO :", err);
  }

  // Photos pour comparaison sur une couleur qui marche (Blanc 3577336 = main)
  console.log("\n\n── Photos Blanc (3577336, main) ──");
  try {
    const photos = await efashionGetProductPhotos(3577336);
    console.log(JSON.stringify(photos, null, 2));
  } catch (err) {
    console.error("getProductPhotos KO :", err);
  }
}

main()
  .catch((err) => console.error(err))
  .finally(() => prisma.$disconnect());
