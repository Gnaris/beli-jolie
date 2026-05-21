/**
 * Script — change la catégorie en « Bague (bijoux femme) » + bascule le poids
 * sur 0.01 kg (10g, typique d'une bague).
 *
 * Usage : npx tsx scripts/efashion-test-change-category-weight.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import { efashionPutShootingProduct } from "@/lib/efashion-shootings";
import { efashionListProducts } from "@/lib/efashion-api";
import { getEfashionAnnexes } from "@/lib/efashion-annexes";

const NEW_REFERENCE = "TEST-EF-8WXZHW";
const SHOOTING_ID = 194774;
const NEW_WEIGHT_KG = 0.01; // 10 g — bague
const ID_COULEUR_TURQUOISE = 185;
const ID_COULEUR_MOUTARDE = 61;

async function main() {
  await ensureEfashionSession();
  console.log("→ Session OK\n");

  // 1. Trouver la catégorie « Bague » côté Bijoux Femme
  console.log("→ Chargement de l'arbre des catégories eFashion...");
  const annexes = await getEfashionAnnexes();
  console.log(`  ✓ ${annexes.categories.length} catégories chargées`);

  const matches = annexes.categories.filter(
    (c) =>
      c.isLeaf &&
      /\bbague/i.test(c.label) &&
      /femme/i.test(c.path) &&
      /bijoux/i.test(c.path),
  );
  console.log(`\n→ Candidates "bague bijoux femme" :`);
  for (const c of matches) console.log(`  • id=${c.id} — ${c.path}`);

  if (matches.length === 0) {
    console.log("\n  ⚠ Pas de catégorie « bague » sous « femme > bijoux » — j'élargis la recherche :");
    const wider = annexes.categories.filter(
      (c) => c.isLeaf && /\bbague/i.test(c.label),
    );
    for (const c of wider) console.log(`  • id=${c.id} — ${c.path}`);
    if (wider.length === 0) throw new Error("Aucune catégorie « Bague » trouvée chez eFashion.");
    matches.push(wider[0]);
  }

  const target = matches[0];
  console.log(`\n→ Catégorie cible retenue : ${target.path} (id ${target.id})`);

  // 2. Lecture du shooting actuel pour ré-envoyer le reste à l'identique
  console.log(`\n→ Lecture du shooting ${SHOOTING_ID}...`);
  const sh = await (await efashionFetch(`/shootings/shooting/${SHOOTING_ID}`, { method: "GET" })).json() as {
    produits: Array<{
      id_produit: number;
      id_vendeur_marque: number;
      id_categorie: number;
      id_declinaison: number;
      id_pack: number;
      id_collection: number;
      id_provenance: number;
      vendu_par: "couleurs" | "tailles";
      prix: string;
      prixReduit: string | null;
      poids: number;
      main: number;
      description_fr: string;
      description_en?: string;
      description_es: string;
      description_it: string;
      description_zh: string;
    }>;
  };
  const principal = sh.produits.find((p) => p.main === 1) ?? sh.produits[0];
  console.log(`  ✓ Catégorie actuelle : ${principal.id_categorie}`);
  console.log(`  ✓ Poids actuel : ${principal.poids} kg`);

  // 3. PUT avec nouvelle catégorie + nouveau poids
  const body = {
    reference: NEW_REFERENCE,
    idVendeurMarque: principal.id_vendeur_marque,
    poids: String(NEW_WEIGHT_KG),
    idCategorie: target.id,
    venduPar: principal.vendu_par,
    idCollection: principal.id_collection,
    idProvenance: principal.id_provenance,
    idDeclinaison: principal.id_declinaison,
    idPack: principal.id_pack,
    prix: String(principal.prix),
    prixReduit: principal.prixReduit ?? null,
    couleurs: [{ id: ID_COULEUR_TURQUOISE }, { id: ID_COULEUR_MOUTARDE }],
    couleurPrincipaleId: ID_COULEUR_MOUTARDE,
    compositions: [{ id: 162, localisationId: 4, percentage: 100 }],
    caracteristiques: [],
    descriptionFr: principal.description_fr,
    descriptionEn: principal.description_en ?? "TEST TO DELETE — automated test product.",
    descriptionIt: principal.description_it,
    descriptionEs: principal.description_es,
    descriptionZh: principal.description_zh || null,
    stock: null,
    dateRemise: "2027-12-31",
    pourcentageRemise: 0,
  };

  console.log(`\n→ PUT /shootings/product/${principal.id_produit}`);
  console.log(`   idCategorie : ${principal.id_categorie} → ${target.id}`);
  console.log(`   poids       : ${principal.poids} → ${NEW_WEIGHT_KG} kg`);

  const result = await efashionPutShootingProduct(principal.id_produit, body);
  console.log(`  ✓ Réponse : success=${result.success}  message=${result.message ?? "—"}`);

  // 4. Vérification
  console.log("\n→ Vérification...");
  const list = await efashionListProducts({
    idVendeur: 2017,
    reference: NEW_REFERENCE,
    premelFilter: "tous",
    take: 10,
  });
  for (const it of list.items) {
    console.log(`  - id=${it.id_produit}  cat=${it.id_categorie}(${it.categorie})  poids=${it.poids}kg  couleur=${it.couleur}  main=${it.main}`);
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`✅ Catégorie → ${target.path}  |  Poids → ${NEW_WEIGHT_KG} kg`);
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
