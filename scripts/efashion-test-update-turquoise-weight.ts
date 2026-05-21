import { efashionUpdateProduit } from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";

async function main() {
  console.log("→ Mise à jour du poids de Turquoise (3665828) → 0.01 kg");
  const r = await efashionUpdateProduit({ id_produit: 3665828, poids: 0.01 });
  console.log("  ✓ Réponse :", r);

  console.log("\n→ Vérification...");
  const list = await efashionListProducts({
    idVendeur: 2017,
    reference: "TEST-EF-8WXZHW",
    premelFilter: "tous",
    take: 10,
  });
  for (const it of list.items) {
    console.log(`  - id=${it.id_produit} couleur=${it.couleur} cat=${it.id_categorie}(${it.categorie}) poids=${it.poids}kg main=${it.main}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
