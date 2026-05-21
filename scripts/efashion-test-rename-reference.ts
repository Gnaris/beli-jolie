/**
 * Script — change la référence du produit test pour une nouvelle au hasard.
 *
 * Usage : npx tsx scripts/efashion-test-rename-reference.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import {
  efashionPutShootingProduct,
  efashionCheckReferencesExist,
} from "@/lib/efashion-shootings";
import { efashionListProducts } from "@/lib/efashion-api";

const SHOOTING_ID = 194774;
const ID_PRODUIT_TURQUOISE = 3665828;
const ID_PRODUIT_MOUTARDE = 3665829;
const ID_COULEUR_TURQUOISE = 185;
const ID_COULEUR_MOUTARDE = 61;

function randomToken(len = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function main() {
  await ensureEfashionSession();
  console.log("→ Session eFashion OK\n");

  // 1. Lit l'état actuel
  console.log(`→ Lecture du shooting ${SHOOTING_ID}...`);
  const res = await efashionFetch(`/shootings/shooting/${SHOOTING_ID}`, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const sh = (await res.json()) as {
    produits: Array<{
      id_produit: number;
      reference: string;
      reference_base: string;
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

  const refAvant = sh.produits[0].reference_base;
  console.log(`  ✓ Référence actuelle : ${refAvant}`);

  // 2. Génère une nouvelle référence au hasard (unique, lisible)
  let newRef = `TEST-EF-${randomToken(6)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const check = await efashionCheckReferencesExist([{ reference: newRef, venduPar: "couleurs" }]);
    if (!check.results[0]?.exists) break;
    console.log(`  ⚠ ${newRef} existe déjà, on retire au hasard...`);
    newRef = `TEST-EF-${randomToken(6)}`;
  }
  console.log(`  → Nouvelle référence choisie : ${newRef}\n`);

  // 3. On envoie le PUT sur le produit principal (Moutarde après le step précédent)
  const principal = sh.produits.find((p) => p.main === 1) ?? sh.produits[0];

  const body = {
    reference: newRef,
    idVendeurMarque: principal.id_vendeur_marque,
    poids: String(principal.poids),
    idCategorie: principal.id_categorie,
    venduPar: principal.vendu_par,
    idCollection: principal.id_collection,
    idProvenance: principal.id_provenance,
    idDeclinaison: principal.id_declinaison,
    idPack: principal.id_pack,
    prix: String(principal.prix),
    prixReduit: principal.prixReduit ?? null,
    couleurs: [
      { id: ID_COULEUR_TURQUOISE },
      { id: ID_COULEUR_MOUTARDE },
    ],
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

  console.log(`→ PUT /shootings/product/${principal.id_produit} avec reference="${newRef}"`);
  const result = await efashionPutShootingProduct(principal.id_produit, body);
  console.log(`  ✓ Réponse : success=${result.success}  message=${result.message ?? "—"}\n`);

  // 4. Vérifie
  console.log("→ Vérification après modification...");
  const list = await efashionListProducts({
    idVendeur: 2017,
    reference: newRef,
    premelFilter: "tous",
    take: 10,
  });
  for (const it of list.items) {
    console.log(
      `  - id_produit=${it.id_produit}  ref=${it.reference}  couleur=${it.couleur}  main=${it.main}  nb_photos=${it.nb_photos}`,
    );
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`✅ Référence modifiée : ${refAvant} → ${newRef}`);
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
