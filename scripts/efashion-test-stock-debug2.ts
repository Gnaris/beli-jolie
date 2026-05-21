import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionUpsertProduitStock } from "@/lib/efashion-api-write";
import { efashionListProducts } from "@/lib/efashion-api";

async function main() {
  await ensureEfashionSession();
  const r1 = await efashionUpsertProduitStock({ id_produit: 3665828, id_couleur: 185, value: 7, taille: "S" });
  console.log(`upsert Turquoise S=7 → ${r1} (type ${typeof r1})`);

  const list1 = await efashionListProducts({ idVendeur: 2017, reference: "TEST-EF-8WXZHW", premelFilter: "tous", take: 10 });
  for (const it of list1.items) {
    console.log(`  [APRÈS 7] id=${it.id_produit} c=${it.couleur} stock_value=${it.stock_value} stock_renseigne=${it.stock_renseigne}`);
  }

  const r2 = await efashionUpsertProduitStock({ id_produit: 3665828, id_couleur: 185, value: 0, taille: "S" });
  console.log(`\nupsert Turquoise S=0 → ${r2} (type ${typeof r2})`);

  const list2 = await efashionListProducts({ idVendeur: 2017, reference: "TEST-EF-8WXZHW", premelFilter: "tous", take: 10 });
  for (const it of list2.items) {
    console.log(`  [APRÈS 0] id=${it.id_produit} c=${it.couleur} stock_value=${it.stock_value} stock_renseigne=${it.stock_renseigne}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.message ?? e); process.exit(1); });
