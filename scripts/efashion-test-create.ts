/**
 * Script de test eFashion — création d'un produit "TEST À SUPPRIMER" avec
 * un maximum de champs renseignés au hasard depuis les référentiels eFashion.
 *
 * Usage :
 *   npx tsx scripts/efashion-test-create.ts
 *
 * ⚠️ Crée un VRAI produit côté eFashion Paris (vendeur 2017).
 * La référence est unique (`TEST-EF-{timestamp}`) et le titre/description
 * indique « TEST À SUPPRIMER » — à supprimer manuellement ensuite via le
 * back-office eFashion OU via `efashionDeleteShootingProduct(idProduit)`.
 *
 * Aucun upload de photo — le produit sera créé sans image (la cliente pourra
 * en ajouter manuellement si besoin pour la suite du test).
 */

import { getEfashionAnnexes } from "@/lib/efashion-annexes";
import {
  efashionCheckReferencesExist,
  efashionSaveMelDraft,
  efashionSaveMelChoice,
  type EfashionMelDraftReference,
} from "@/lib/efashion-shootings";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe } from "@/lib/efashion-api";

function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("Liste vide — impossible de piocher");
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("→ Connexion eFashion...");
  await ensureEfashionSession();
  const me = await efashionGetMe();
  console.log(`  ✓ Connecté en tant que « ${me.nomBoutique} » (vendeur n°${me.id_vendeur})`);

  console.log("→ Chargement des référentiels eFashion...");
  const annexes = await getEfashionAnnexes();
  console.log(`  ✓ ${annexes.categories.length} catégories, ${annexes.provenances.length} provenances, ${annexes.collections.length} collections, ${annexes.declinaisons.length} déclinaisons, ${annexes.colors.length} couleurs (dont ${annexes.colors.filter((c) => c.inVendorCatalog).length} dans catalogue vendeur), ${annexes.packs.length} packs, ${annexes.compositions.length} compositions`);

  // ─── Choix aléatoires ─────────────────────────────────────────────────────

  // Catégorie : on prend une feuille (les non-feuilles ne sont pas valides pour create)
  const leafCategories = annexes.categories.filter((c) => c.isLeaf);
  const category = pickRandom(leafCategories);

  // Provenance, collection, déclinaison, pack
  const provenance = pickRandom(annexes.provenances);
  const collection = pickRandom(annexes.collections);
  const declinaison = pickRandom(annexes.declinaisons.filter((d) => d.sizes.length > 0));
  const pack = pickRandom(annexes.packs);

  // Couleurs : 2 couleurs dans le catalogue vendeur (évite addCouleurToVendeur)
  const vendorColors = annexes.colors.filter((c) => c.inVendorCatalog);
  if (vendorColors.length < 2) {
    throw new Error("Pas assez de couleurs dans le catalogue vendeur (besoin de 2 minimum)");
  }
  const color1 = pickRandom(vendorColors);
  let color2 = pickRandom(vendorColors);
  let safety = 0;
  while (color2.id === color1.id && safety++ < 20) color2 = pickRandom(vendorColors);

  // Composition : 1 seule, 100%
  const composition = pickRandom(annexes.compositions);

  // ─── Construction de la référence + champs ───────────────────────────────

  const timestamp = Date.now();
  const reference = `TEST-EF-${timestamp}`;
  const venduPar: "couleurs" | "tailles" = "couleurs";

  console.log("");
  console.log("→ Valeurs piochées au hasard :");
  console.log(`  • Référence : ${reference}`);
  console.log(`  • Catégorie : ${category.path} (id ${category.id})`);
  console.log(`  • Provenance : ${provenance.libelle} (id ${provenance.id})`);
  console.log(`  • Collection : ${collection.label} (id ${collection.id})`);
  console.log(`  • Déclinaison : ${declinaison.titre} (id ${declinaison.id}, ${declinaison.sizes.length} tailles)`);
  console.log(`  • Pack : ${pack.label} (id ${pack.id}, qty ${pack.quantity})`);
  console.log(`  • Couleur 1 : ${color1.fr} (id ${color1.id})  ← principale`);
  console.log(`  • Couleur 2 : ${color2.fr} (id ${color2.id})`);
  console.log(`  • Composition : ${composition.label} (id ${composition.id}) à 100%`);
  console.log("");

  // ─── Vérifie que la référence n'existe pas (devrait être unique) ─────────

  console.log("→ Vérification que la référence n'existe pas déjà côté eFashion...");
  const refCheck = await efashionCheckReferencesExist([{ reference, venduPar }]);
  const existing = refCheck.results.find((r) => r.reference === reference);
  if (existing?.exists) {
    throw new Error(`La référence ${reference} existe déjà chez eFashion — improbable, à investiguer`);
  }
  console.log("  ✓ Référence disponible");

  // ─── Construction du payload ──────────────────────────────────────────────

  const draftReference: EfashionMelDraftReference = {
    id: `bj-test-${timestamp}`,
    reference,
    marque: "3228", // BJ id_vendeur_marque (cf. doc)
    poids: "0.05",
    categorie: String(category.id),
    venduPar,
    collection: String(collection.id),
    paysOrigine: String(provenance.id),
    taillePaquet: String(declinaison.id),
    quantitePaquet: String(pack.id),
    stock: "",
    prix: "9.99",
    prixReduit: "",
    dateRemise: "2027-12-31",
    pourcentageRemise: "0",
    dimensions: "",
    minimumCommande: "",
    descriptionFr: "TEST À SUPPRIMER — produit créé automatiquement via script de test Beli & Jolie.",
    descriptionEn: "TEST TO DELETE — automated test product from Beli & Jolie integration script.",
    descriptionIt: "TEST DA ELIMINARE — prodotto creato automaticamente.",
    descriptionEs: "PRUEBA PARA ELIMINAR — producto creado automáticamente.",
    descriptionZh: null,
    couleurs: [
      { id: color1.id, nom: color1.fr, isMain: true },
      { id: color2.id, nom: color2.fr, isMain: false },
    ],
    compositions: [{ id: composition.id, localisationId: 4, percentage: 100 }],
    caracteristiques: [],
  };

  // ─── Étape 1 : save-mel-draft ─────────────────────────────────────────────

  console.log("→ Étape 1/2 : save-mel-draft (création du brouillon)...");
  const draftResult = await efashionSaveMelDraft({ references: [draftReference] });
  if (!draftResult.success || draftResult.productIds.length === 0) {
    throw new Error(`save-mel-draft a échoué : ${draftResult.message ?? "raison inconnue"}`);
  }
  console.log(`  ✓ ${draftResult.productIds.length} productIds créés : ${draftResult.productIds.join(", ")}`);

  // ─── Étape 2 : save-mel-choice (option upload) ────────────────────────────

  console.log("→ Étape 2/2 : save-mel-choice (option upload, pas de studio)...");
  const choiceRefs = draftResult.productIds.map((pid) => ({
    ...draftReference,
    id: `db-${pid}`,
  }));
  const choiceResult = await efashionSaveMelChoice({ references: choiceRefs });
  if (!choiceResult.success) {
    throw new Error(`save-mel-choice a échoué : ${choiceResult.message ?? "raison inconnue"}`);
  }
  console.log(`  ✓ Shooting(s) créé(s) : ${JSON.stringify(choiceResult.shootings)}`);

  // ─── Récap ────────────────────────────────────────────────────────────────

  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log("✅ PRODUIT DE TEST CRÉÉ AVEC SUCCÈS SUR eFASHION");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`Référence eFashion : ${reference}`);
  console.log(`Product IDs (1 par couleur) : ${draftResult.productIds.join(", ")}`);
  console.log(`Shooting IDs : ${choiceResult.shootings.map((s) => s.id).join(", ")}`);
  console.log("");
  console.log("⚠️  À FAIRE ENSUITE :");
  console.log("   1. Vérifiez dans le back-office eFashion (wholesaler.efashion-paris.com)");
  console.log("      que le produit apparaît bien (probablement en brouillon).");
  console.log("   2. Pour le supprimer ensuite, lancez :");
  draftResult.productIds.forEach((pid) => {
    console.log(`        npx tsx -e "import('./lib/efashion-shootings').then(m => m.efashionDeleteShootingProduct(${pid}).then(r => console.log(r)))"`);
  });
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("");
    console.error("❌ ÉCHEC DU TEST :");
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
