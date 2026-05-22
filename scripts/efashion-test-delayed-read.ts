/**
 * Hypothèse : updateProduit déclenche une propagation asynchrone.
 * Test : 1 update sur Argent, lecture immédiate, attendre 10s, relire.
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

async function dump(label: string) {
  const s = await fetchState();
  console.log(`\n--- ${label} ---`);
  for (const it of s) console.log(`  ${it.couleur.padEnd(10)} prix=${it.prix}€`);
}

async function main() {
  await ensureEfashionSession();

  await dump("Initial");

  const before = await fetchState();
  const argent = before.find((it) => it.couleur.toLowerCase() === "argent")!;

  console.log("\n--- updateProduit(Argent, prix=55) ---");
  await efashionUpdateProduit({
    id_produit: argent.id_produit,
    reference: argent.reference,
    reference_base: argent.reference_base,
    visible: argent.visible,
    prix: 55,
    prixReduit: null,
    poids: 0.03,
    vendu_par: argent.vendu_par,
    id_vendeur_marque: argent.id_vendeur_marque,
    id_provenance: argent.id_provenance ?? undefined,
    id_collection: argent.id_collection,
    id_declinaison: argent.id_declinaison ?? undefined,
    id_pack: argent.id_pack,
    id_categorie: argent.id_categorie,
  });

  await dump("Après update (lecture immédiate)");
  await new Promise((r) => setTimeout(r, 3000));
  await dump("Après update + 3s");
  await new Promise((r) => setTimeout(r, 7000));
  await dump("Après update + 10s");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
