/**
 * Diagnostic — peut-on ajouter une couleur à un produit eFashion existant
 * via PUT /shootings/product/{id} sans casser les id_produit des couleurs déjà
 * présentes ?
 *
 * Contexte : la doc API §5 dit « la modification globale du produit (PUT avec
 * la couleur dans couleurs[]) re-créera un nouveau id_produit ». Pas clair si
 * ça concerne SEULEMENT la couleur ajoutée ou toutes les couleurs du produit.
 * Ce script tranche par observation.
 *
 * ⚠️ À LANCER MANUELLEMENT SUR UN PRODUIT TEST UNIQUEMENT.
 *    Ne pas lancer sur un produit lié en BDD locale — si le PUT recrée tous
 *    les id_produit, on perdra les liens efashionProductId locaux du produit.
 *
 * Usage :
 *   1. Créer un produit test côté eFashion avec 2 couleurs minimum (ex: "TESTDIAG")
 *   2. Lancer : `npx tsx scripts/efashion-test-add-color-via-put.ts TESTDIAG`
 *   3. Observer les logs :
 *      - id_produit AVANT pour chaque couleur (snapshot 1)
 *      - PUT envoyé avec 1 nouvelle couleur
 *      - id_produit APRÈS pour chaque couleur (snapshot 2)
 *      - DIFF : quelles couleurs ont changé d'id ?
 *   4. Décision :
 *      - Si SEULE la nouvelle couleur a un nouvel id → option « créer côté
 *        eFashion » est faisable proprement. On l'active dans la modale.
 *      - Si TOUTES les couleurs ont un nouvel id → option non faisable
 *        sans refactor lourd des liens BDD. On garde le bouton grisé.
 */

import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import {
  efashionPutShootingProduct,
  type EfashionPutProductInput,
} from "@/lib/efashion-shootings";
import { logger } from "@/lib/logger";

const NEW_COLOR_ID_FOR_TEST = 78; // "Doré" — couleur générique présente partout

async function main() {
  const referenceBase = process.argv[2];
  if (!referenceBase) {
    console.error("Usage: npx tsx scripts/efashion-test-add-color-via-put.ts <REFERENCE_BASE>");
    process.exit(1);
  }

  const vendor = await efashionGetMe();
  console.log(`\n=== Vendor : ${vendor.nomBoutique} (id=${vendor.id_vendeur}) ===\n`);

  // Snapshot AVANT
  const before = await efashionListProducts({
    idVendeur: vendor.id_vendeur,
    take: 100,
    reference: referenceBase,
  });
  const beforeRows = before.items.filter(
    (it) => it.reference_base?.toLowerCase().trim() === referenceBase.toLowerCase().trim(),
  );

  if (beforeRows.length === 0) {
    console.error(`Aucune ligne trouvée pour "${referenceBase}". Créez d'abord ce produit test.`);
    process.exit(1);
  }

  console.log("AVANT le PUT :");
  for (const r of beforeRows) {
    console.log(
      `  id_produit=${r.id_produit}  couleur=${r.couleur} (id_couleur=${r.id_couleur})  ` +
        `nb_photos=${r.nb_photos}  visible=${r.visible}`,
    );
  }

  // Récupère le premier pour avoir les champs nécessaires au PUT
  const ref = beforeRows[0];
  const existingColorIds = beforeRows.map((r) => r.id_couleur);

  if (existingColorIds.includes(NEW_COLOR_ID_FOR_TEST)) {
    console.error(
      `La couleur de test (id_couleur=${NEW_COLOR_ID_FOR_TEST}) existe déjà sur ce produit. ` +
        "Changez NEW_COLOR_ID_FOR_TEST en haut du script ou utilisez un autre produit.",
    );
    process.exit(1);
  }

  // Construit le PUT avec la couleur en plus
  const putInput: EfashionPutProductInput = {
    reference: ref.reference_base,
    idVendeurMarque: ref.id_vendeur_marque,
    poids: String(ref.poids),
    idCategorie: String(ref.id_categorie),
    venduPar: ref.vendu_par as "couleurs" | "tailles",
    idCollection: String(ref.id_collection),
    idProvenance: String(ref.id_provenance),
    idDeclinaison: ref.id_declinaison,
    idPack: ref.id_pack,
    prix: String(ref.prix),
    prixReduit: null,
    couleurs: [...existingColorIds.map((id) => ({ id })), { id: NEW_COLOR_ID_FOR_TEST }],
    couleurPrincipaleId: existingColorIds[0],
    compositions: [],
    caracteristiques: [],
    descriptionFr: "",
    descriptionEn: "",
    descriptionIt: "",
    descriptionEs: "",
    descriptionZh: null,
    stock: null,
    dateRemise: "2037-12-31",
    pourcentageRemise: 0,
  };

  console.log(
    `\nEnvoi PUT /shootings/product/${ref.id_produit} avec ${putInput.couleurs.length} couleurs ` +
      `(${existingColorIds.length} existantes + 1 nouvelle id_couleur=${NEW_COLOR_ID_FOR_TEST})...\n`,
  );

  const putRes = await efashionPutShootingProduct(ref.id_produit, putInput);
  console.log("Réponse PUT :", putRes);

  if (!putRes.success) {
    console.error("PUT a échoué — abandon.");
    process.exit(1);
  }

  // Snapshot APRÈS
  const after = await efashionListProducts({
    idVendeur: vendor.id_vendeur,
    take: 100,
    reference: referenceBase,
  });
  const afterRows = after.items.filter(
    (it) => it.reference_base?.toLowerCase().trim() === referenceBase.toLowerCase().trim(),
  );

  console.log("\nAPRÈS le PUT :");
  for (const r of afterRows) {
    console.log(
      `  id_produit=${r.id_produit}  couleur=${r.couleur} (id_couleur=${r.id_couleur})  ` +
        `nb_photos=${r.nb_photos}  visible=${r.visible}`,
    );
  }

  // DIFF — pour chaque couleur existante avant, est-ce que son id_produit a changé ?
  console.log("\n=== DIFF ===");
  let allKept = true;
  for (const beforeRow of beforeRows) {
    const afterRow = afterRows.find((r) => r.id_couleur === beforeRow.id_couleur);
    if (!afterRow) {
      console.log(
        `❌ Couleur id_couleur=${beforeRow.id_couleur} (${beforeRow.couleur}) DISPARUE après PUT`,
      );
      allKept = false;
    } else if (afterRow.id_produit !== beforeRow.id_produit) {
      console.log(
        `🔄 Couleur id_couleur=${beforeRow.id_couleur} (${beforeRow.couleur}) : ` +
          `id_produit ${beforeRow.id_produit} → ${afterRow.id_produit} (CHANGÉ)`,
      );
      allKept = false;
    } else {
      console.log(
        `✅ Couleur id_couleur=${beforeRow.id_couleur} (${beforeRow.couleur}) : ` +
          `id_produit ${beforeRow.id_produit} conservé`,
      );
    }
  }

  const newOnly = afterRows.find((r) => r.id_couleur === NEW_COLOR_ID_FOR_TEST);
  if (newOnly) {
    console.log(`✨ Nouvelle couleur ajoutée : id_produit=${newOnly.id_produit} (${newOnly.couleur})`);
  } else {
    console.log(`❌ La nouvelle couleur id_couleur=${NEW_COLOR_ID_FOR_TEST} n'apparaît pas`);
  }

  console.log("\n=== VERDICT ===");
  if (allKept) {
    console.log(
      "✅ Les id_produit existants sont CONSERVÉS — la création « ajouter une couleur via PUT » " +
        "est SAFE. On peut activer l'auto-création côté eFashion dans la modale.",
    );
  } else {
    console.log(
      "❌ Au moins un id_produit existant a CHANGÉ — la création via PUT casse les liens BDD. " +
        "On garde le bouton grisé tant qu'on n'a pas une mutation spécifique « addColor ».",
    );
  }
}

main()
  .catch((err) => {
    logger.error("[diag] Erreur", { error: err });
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
