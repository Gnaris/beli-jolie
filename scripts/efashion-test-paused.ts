/**
 * Test : pause entre 2 updateProduit + variantes sans id_pack
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
  const dore = before.find((it) => it.couleur.toLowerCase() === "doré")!;

  console.log("\n=== TEST 1: 2 updates avec pause de 5s entre ===");
  await efashionUpdateProduit({
    id_produit: argent.id_produit,
    reference: argent.reference,
    reference_base: argent.reference_base,
    visible: argent.visible,
    prix: 33,
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
  await dump("Après Argent=33 (immédiat)");
  await new Promise((r) => setTimeout(r, 5000));
  await efashionUpdateProduit({
    id_produit: dore.id_produit,
    reference: dore.reference,
    reference_base: dore.reference_base,
    visible: dore.visible,
    prix: 44,
    prixReduit: null,
    poids: 0.03,
    vendu_par: dore.vendu_par,
    id_vendeur_marque: dore.id_vendeur_marque,
    id_provenance: dore.id_provenance ?? undefined,
    id_collection: dore.id_collection,
    id_declinaison: dore.id_declinaison ?? undefined,
    id_pack: dore.id_pack,
    id_categorie: dore.id_categorie,
  });
  await dump("Après Doré=44 (immédiat)");

  console.log("\n=== TEST 2: 2 updates payload MINIMAL (que id_produit+prix) ===");
  await efashionUpdateProduit({ id_produit: argent.id_produit, prix: 66 });
  await dump("Après Argent=66 minimal");
  await efashionUpdateProduit({ id_produit: dore.id_produit, prix: 77 });
  await dump("Après Doré=77 minimal");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
