/**
 * Diag — teste si saveProduitStocks persiste les valeurs positives, puis remet à 0.
 *
 * Hypothèse 1 : value=0 est traité comme "rupture" (entrée créée, valeur stockée null/0).
 * Hypothèse 2 : value=0 supprime l'entrée.
 *
 * On va d'abord poser value=5 sur Turquoise S, vérifier ce que ça donne dans le shooting,
 * puis le repasser à 0 et vérifier à nouveau.
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";
import { efashionSaveProduitStocks } from "@/lib/efashion-api-write";

const SHOOTING_ID = 194774;
const ID_PRODUIT_TURQUOISE = 3665828;
const ID_COULEUR_TURQUOISE = 185;

async function readStocks() {
  const r = await efashionFetch(`/shootings/shooting/${SHOOTING_ID}`, { method: "GET" });
  const j = (await r.json()) as {
    produits: Array<{
      id_produit: number;
      couleurs_stocks: Array<{
        id_couleur: number;
        stock: number | null;
        tailleStocks: Array<{ taille: string; stock: number | null }>;
      }>;
    }>;
  };
  for (const p of j.produits) {
    for (const cs of p.couleurs_stocks) {
      const det = cs.tailleStocks.map((ts) => `${ts.taille}=${ts.stock ?? "null"}`).join(", ");
      console.log(`   id_produit=${p.id_produit} couleur=${cs.id_couleur} stock=${cs.stock ?? "null"} tailles=[${det}]`);
    }
  }
}

async function main() {
  await ensureEfashionSession();
  console.log("→ Étape 1 — état actuel :");
  await readStocks();

  console.log(`\n→ Étape 2 — pose value=5 sur Turquoise S/M/L`);
  await efashionSaveProduitStocks({
    id_produit: ID_PRODUIT_TURQUOISE,
    items: [
      { id_couleur: ID_COULEUR_TURQUOISE, value: 5, taille: "S" },
      { id_couleur: ID_COULEUR_TURQUOISE, value: 5, taille: "M" },
      { id_couleur: ID_COULEUR_TURQUOISE, value: 5, taille: "L" },
    ],
  });
  console.log("→ Relecture :");
  await readStocks();

  console.log(`\n→ Étape 3 — repasse Turquoise S/M/L à 0`);
  await efashionSaveProduitStocks({
    id_produit: ID_PRODUIT_TURQUOISE,
    items: [
      { id_couleur: ID_COULEUR_TURQUOISE, value: 0, taille: "S" },
      { id_couleur: ID_COULEUR_TURQUOISE, value: 0, taille: "M" },
      { id_couleur: ID_COULEUR_TURQUOISE, value: 0, taille: "L" },
    ],
  });
  console.log("→ Relecture :");
  await readStocks();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
