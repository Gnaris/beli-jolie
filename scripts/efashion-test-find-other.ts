/**
 * Diagnostic : retrouve TOUS les produits "TEST*" du vendeur 2017 + détails
 * du shooting 194774 (le nôtre) pour comprendre d'où viennent les couleurs.
 *
 * Usage : npx tsx scripts/efashion-test-find-other.ts
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { efashionFetch } from "@/lib/efashion-client";
import { efashionGraphql } from "@/lib/efashion-client";

async function main() {
  await ensureEfashionSession();
  const me = await efashionGetMe();
  console.log(`Vendeur ${me.id_vendeur} — ${me.nomBoutique}\n`);

  console.log("=== 1) Tous les produits préfixés « TEST » ===");
  for (const filter of ["tous", "brouillon"] as const) {
    const res = await efashionListProducts({
      idVendeur: me.id_vendeur,
      take: 100,
      reference: "TEST",
      premelFilter: filter,
    });
    console.log(`\nFiltre "${filter}" — ${res.items.length} items (total=${res.total})`);
    for (const it of res.items) {
      console.log(`  id=${it.id_produit}  ref=${it.reference}  couleur=${it.couleur}(${it.id_couleur})  nb_photos=${it.nb_photos}  main=${it.main}  supprimer=${it.supprimer}`);
    }
    if (res.items.length === 0) continue;
  }

  console.log("\n=== 2) Détail du shooting 194774 (notre test) ===");
  try {
    const r = await efashionFetch("/shootings/shooting/194774", { method: "GET" });
    const txt = await r.text();
    console.log(txt.slice(0, 3000));
  } catch (err) {
    console.log("Erreur :", err instanceof Error ? err.message : err);
  }

  console.log("\n=== 3) Couleurs validées de votre catalogue vendeur ===");
  try {
    const data = await efashionGraphql<{
      couleursByVendeur: Array<{
        id_couleur: number;
        couleur_FR: string;
        hexColor: string | null;
      }>;
    }>(
      `query GetCouleurs { couleursByVendeur(id_vendeur: ${me.id_vendeur}) { id_couleur couleur_FR hexColor } }`,
    );
    const seen = new Set<number>();
    const uniq = data.couleursByVendeur.filter((c) => {
      if (seen.has(c.id_couleur)) return false;
      seen.add(c.id_couleur);
      return true;
    });
    console.log(`${uniq.length} couleurs validées chez eFashion :`);
    for (const c of uniq) {
      console.log(`  id=${c.id_couleur}  ${c.couleur_FR}  hex=${c.hexColor ?? "—"}`);
    }
  } catch (err) {
    console.log("Erreur :", err instanceof Error ? err.message : err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
