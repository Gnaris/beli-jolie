import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionFetch } from "@/lib/efashion-client";

async function main() {
  await ensureEfashionSession();
  const r = await efashionFetch("/shootings/shooting/194774", { method: "GET" });
  const j = (await r.json()) as {
    produits: Array<{
      id_produit: number;
      couleurs: string[];
      couleurs_stocks: Array<{
        id_couleur: number;
        stock: number | null;
        tailleStocks: Array<{ taille: string; stock: number | null }>;
      }>;
    }>;
  };
  for (const p of j.produits) {
    console.log(`id_produit=${p.id_produit}  couleurs=[${p.couleurs.join(", ")}]`);
    for (const cs of p.couleurs_stocks) {
      const det = cs.tailleStocks.map((ts) => `${ts.taille}=${ts.stock ?? "null"}`).join(", ");
      console.log(`  couleur ${cs.id_couleur}: stock=${cs.stock ?? "null"}  tailles=[${det}]`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
