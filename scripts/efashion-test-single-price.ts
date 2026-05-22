/**
 * Test isolé : un seul updateProduit avec un nouveau prix propage-t-il
 * aux autres couleurs ? Sur F137 actuellement les 2 sont à 187€.
 * On va envoyer prix=42 à Argent seulement, puis relire les 2 couleurs.
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

async function main() {
  await ensureEfashionSession();

  console.log("\n--- État initial ---");
  const before = await fetchState();
  for (const it of before) {
    console.log(`  efId=${it.id_produit}  ${it.couleur.padEnd(10)} prix=${it.prix}€  (vendu_par=${it.vendu_par}, id_pack=${it.id_pack}, id_decl=${it.id_declinaison})`);
  }

  const argent = before.find((it) => it.couleur.toLowerCase() === "argent");
  if (!argent) throw new Error("Argent introuvable");

  console.log("\n--- Envoi UNIQUEMENT updateProduit(Argent, prix=42) avec payload complet ---");
  const res = await efashionUpdateProduit({
    id_produit: argent.id_produit,
    reference: argent.reference,
    reference_base: argent.reference_base,
    visible: argent.visible,
    prix: 42,
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
  console.log("Réponse :", res);

  console.log("\n--- État après 1 seul update ---");
  const after = await fetchState();
  for (const it of after) {
    console.log(`  efId=${it.id_produit}  ${it.couleur.padEnd(10)} prix=${it.prix}€`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
