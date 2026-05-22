/**
 * Hypothèse : la couleur main=true propage, les autres non.
 * Donc on doit envoyer la main EN PREMIER, puis les non-main après.
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { efashionUpdateProduit } from "@/lib/efashion-api-write";

async function fetchState() {
  const me = await efashionGetMe();
  const list = await efashionListProducts({
    idVendeur: me.id_vendeur,
    take: 100,
    reference: "F137",
    premelFilter: "en_ligne",
  });
  return list.items.filter((it) => it.reference_base === "F137");
}

async function update(item: Awaited<ReturnType<typeof fetchState>>[number], newPrix: number) {
  await efashionUpdateProduit({
    id_produit: item.id_produit,
    reference: item.reference,
    reference_base: item.reference_base,
    visible: item.visible,
    prix: newPrix,
    prixReduit: null,
    poids: 0.03,
    vendu_par: item.vendu_par,
    id_vendeur_marque: item.id_vendeur_marque,
    id_provenance: item.id_provenance ?? undefined,
    id_collection: item.id_collection,
    id_declinaison: item.id_declinaison ?? undefined,
    id_pack: item.id_pack,
    id_categorie: item.id_categorie,
  });
}

async function dump(label: string) {
  const s = await fetchState();
  console.log(`\n--- ${label} ---`);
  for (const it of s) console.log(`  ${it.couleur.padEnd(10)} prix=${it.prix}€  main=${it.main}`);
}

async function main() {
  await ensureEfashionSession();
  await dump("Initial");
  const before = await fetchState();

  const mainColor = before.find((it) => it.main);
  const others = before.filter((it) => !it.main);
  if (!mainColor) throw new Error("Pas de main color");

  console.log(`\nMain = ${mainColor.couleur} (efId=${mainColor.id_produit})`);
  console.log("\n=== ORDRE : main d'abord, autres après ===");
  await update(mainColor, 100);
  await dump(`Après ${mainColor.couleur} (main)=100`);
  for (const o of others) {
    await update(o, 200);
    await dump(`Après ${o.couleur} (non-main)=200`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
