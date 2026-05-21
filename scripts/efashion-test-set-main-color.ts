/**
 * Script — bascule la couleur principale du produit test sur Moutarde.
 *
 * Usage : npx tsx scripts/efashion-test-set-main-color.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import { efashionPutShootingProduct } from "@/lib/efashion-shootings";
import { efashionListProducts } from "@/lib/efashion-api";

const TEST_REFERENCE_BASE = "TEST-EF-1779396051112";
const ID_PRODUIT_TURQUOISE = 3665828;
const ID_PRODUIT_MOUTARDE = 3665829;
const ID_COULEUR_TURQUOISE = 185;
const ID_COULEUR_MOUTARDE = 61;
const NEW_PRINCIPAL = ID_COULEUR_MOUTARDE;

async function main() {
  await ensureEfashionSession();
  console.log("→ Session eFashion OK\n");

  // 1. Lire l'état actuel du shooting (qui porte tous les champs nécessaires)
  console.log("→ Lecture du shooting actuel...");
  const res = await efashionFetch("/shootings/shooting/194774", { method: "GET" });
  if (!res.ok) throw new Error(`Lecture shooting HTTP ${res.status}`);
  const sh = (await res.json()) as {
    success: boolean;
    produits: Array<{
      id_produit: number;
      id_vendeur_marque: number;
      id_categorie: number;
      id_declinaison: number;
      id_pack: number;
      id_collection: number;
      id_provenance: number;
      reference: string;
      reference_base: string;
      vendu_par: "couleurs" | "tailles";
      prix: string | number;
      prixReduit: string | number | null;
      poids: number;
      visible: number;
      couleurs_ids: number[];
      compositions_ids: number[];
      caracteristiques_ids: number[];
      description_fr: string;
      description_en?: string;
      description_es: string;
      description_it: string;
      description_zh: string;
      dateRemise: string;
      pourcentageRemise: number | null;
      main: number;
    }>;
  };

  const principalAvant = sh.produits.find((p) => p.main === 1);
  console.log(
    `  ✓ Couleur principale AVANT : ${principalAvant?.reference ?? "?"} (id_produit=${principalAvant?.id_produit})`,
  );

  // 2. On prend le produit qui détient les méta (n'importe lequel, on prend le main)
  const ref = principalAvant ?? sh.produits[0];

  // 3. Construit le body PUT en gardant tout pareil sauf couleurPrincipaleId
  const body = {
    reference: TEST_REFERENCE_BASE,
    idVendeurMarque: ref.id_vendeur_marque,
    poids: String(ref.poids),
    idCategorie: ref.id_categorie,
    venduPar: ref.vendu_par,
    idCollection: ref.id_collection,
    idProvenance: ref.id_provenance,
    idDeclinaison: ref.id_declinaison,
    idPack: ref.id_pack,
    prix: String(ref.prix),
    prixReduit: ref.prixReduit ?? null,
    couleurs: [
      { id: ID_COULEUR_TURQUOISE },
      { id: ID_COULEUR_MOUTARDE },
    ],
    couleurPrincipaleId: NEW_PRINCIPAL,
    compositions: [{ id: 162, localisationId: 4, percentage: 100 }], // Silicone 100%
    caracteristiques: [],
    descriptionFr:
      ref.description_fr || "TEST À SUPPRIMER — produit créé via script de test BJ.",
    descriptionEn:
      ref.description_en || "TEST TO DELETE — automated test product.",
    descriptionIt: ref.description_it || "TEST DA ELIMINARE.",
    descriptionEs: ref.description_es || "PRUEBA PARA ELIMINAR.",
    descriptionZh: ref.description_zh || null,
    stock: null,
    dateRemise: "2027-12-31",
    pourcentageRemise: ref.pourcentageRemise ?? 0,
  };

  console.log(`\n→ Envoi PUT /shootings/product/${ref.id_produit} avec couleurPrincipaleId=${NEW_PRINCIPAL} (Moutarde)`);
  const result = await efashionPutShootingProduct(ref.id_produit, body);
  console.log(`  ✓ Réponse : success=${result.success}  message=${result.message ?? "—"}`);

  // 4. Vérifie via le listing après coup
  console.log("\n→ Vérification après modification...");
  const list = await efashionListProducts({
    idVendeur: 2017,
    reference: TEST_REFERENCE_BASE,
    premelFilter: "tous",
    take: 10,
  });
  for (const it of list.items) {
    console.log(
      `  - id_produit=${it.id_produit}  couleur=${it.couleur}(${it.id_couleur})  main=${it.main}  nb_photos=${it.nb_photos}`,
    );
  }

  const newMain = list.items.find((i) => i.main);
  console.log(
    `\n  ✓ Couleur principale APRÈS : ${newMain?.couleur ?? "?"} (id_produit=${newMain?.id_produit})`,
  );

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("✅ Couleur principale changée");
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
