/**
 * Test : 2 updateProduit successifs (sans aucun autre appel)
 * pour isoler la cause de la propagation.
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

async function buildPayload(item: Awaited<ReturnType<typeof fetchState>>[number], newPrix: number) {
  return {
    id_produit: item.id_produit,
    reference: item.reference,
    reference_base: item.reference_base,
    visible: item.visible,
    prix: newPrix,
    prixReduit: null as null,
    poids: 0.03,
    vendu_par: item.vendu_par,
    id_vendeur_marque: item.id_vendeur_marque,
    id_provenance: item.id_provenance ?? undefined,
    id_collection: item.id_collection,
    id_declinaison: item.id_declinaison ?? undefined,
    id_pack: item.id_pack,
    id_categorie: item.id_categorie,
  };
}

async function main() {
  await ensureEfashionSession();

  console.log("\n--- État initial ---");
  const before = await fetchState();
  for (const it of before) console.log(`  ${it.couleur.padEnd(10)} prix=${it.prix}€  efId=${it.id_produit}`);

  const argent = before.find((it) => it.couleur.toLowerCase() === "argent")!;
  const dore = before.find((it) => it.couleur.toLowerCase() === "doré")!;

  console.log("\n--- updateProduit(Argent, prix=11) ---");
  const r1 = await efashionUpdateProduit(await buildPayload(argent, 11));
  console.log(`  réponse prix=${r1.prix}`);

  console.log("\n--- updateProduit(Doré, prix=22) ---");
  const r2 = await efashionUpdateProduit(await buildPayload(dore, 22));
  console.log(`  réponse prix=${r2.prix}`);

  console.log("\n--- État après les 2 updates ---");
  const after = await fetchState();
  for (const it of after) console.log(`  ${it.couleur.padEnd(10)} prix=${it.prix}€`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
