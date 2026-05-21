/**
 * Script — met Moutarde et Turquoise en rupture (stock = 0 sur toutes les tailles).
 *
 * Usage : npx tsx scripts/efashion-test-set-outofstock.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionSaveProduitStocks } from "@/lib/efashion-api-write";
import { efashionGraphql } from "@/lib/efashion-client";

const ID_PRODUIT_TURQUOISE = 3665828;
const ID_PRODUIT_MOUTARDE = 3665829;
const ID_COULEUR_TURQUOISE = 185;
const ID_COULEUR_MOUTARDE = 61;

// La déclinaison active = "Test 5641" avec [S, M, L]
const SIZES = ["S", "M", "L"];

async function readStock(idProduit: number) {
  await ensureEfashionSession();
  const data = await efashionGraphql<{
    produitStocks: Array<{
      id_couleur: number;
      taille: string | null;
      stock: number | null;
    }>;
  }>(
    `query ProduitStocks($id_produit: Int!) {
      produitStocks(id_produit: $id_produit) {
        id_couleur
        taille
        stock
      }
    }`,
    { id_produit: idProduit },
  );
  return data.produitStocks ?? [];
}

async function main() {
  await ensureEfashionSession();
  console.log("→ Session OK\n");

  // ─── 1) Etat AVANT ─────────────────────────────────────────────────────
  for (const [label, id] of [["Turquoise", ID_PRODUIT_TURQUOISE], ["Moutarde", ID_PRODUIT_MOUTARDE]] as const) {
    console.log(`→ Stock AVANT pour ${label} (id_produit ${id})`);
    try {
      const rows = await readStock(id);
      if (rows.length === 0) {
        console.log(`   (aucune entrée stock pour cette couleur)`);
      } else {
        rows.forEach((r) =>
          console.log(`   couleur=${r.id_couleur}  taille=${r.taille ?? "-"}  stock=${r.stock ?? "null"}`),
        );
      }
    } catch (err) {
      console.log(`   ⚠ Erreur lecture stock : ${err instanceof Error ? err.message : err}`);
    }
  }

  // ─── 2) Mise à zéro ─────────────────────────────────────────────────────
  console.log("\n→ Mise à 0 du stock sur Turquoise et Moutarde (toutes tailles)...");

  const turquoiseItems = SIZES.map((t) => ({ id_couleur: ID_COULEUR_TURQUOISE, value: 0, taille: t }));
  const moutardeItems = SIZES.map((t) => ({ id_couleur: ID_COULEUR_MOUTARDE, value: 0, taille: t }));

  const r1 = await efashionSaveProduitStocks({
    id_produit: ID_PRODUIT_TURQUOISE,
    items: turquoiseItems,
  });
  console.log(`  Turquoise : saveProduitStocks → ${r1}`);

  const r2 = await efashionSaveProduitStocks({
    id_produit: ID_PRODUIT_MOUTARDE,
    items: moutardeItems,
  });
  console.log(`  Moutarde  : saveProduitStocks → ${r2}`);

  // ─── 3) Etat APRÈS ──────────────────────────────────────────────────────
  console.log("\n→ Stock APRÈS");
  for (const [label, id] of [["Turquoise", ID_PRODUIT_TURQUOISE], ["Moutarde", ID_PRODUIT_MOUTARDE]] as const) {
    console.log(`   ${label} (id_produit ${id}) :`);
    const rows = await readStock(id);
    if (rows.length === 0) {
      console.log(`     (aucune entrée)`);
    } else {
      rows.forEach((r) =>
        console.log(`     couleur=${r.id_couleur}  taille=${r.taille ?? "-"}  stock=${r.stock ?? "null"}`),
      );
    }
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log("✅ Turquoise + Moutarde mis en rupture de stock (S/M/L = 0)");
  console.log("════════════════════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
