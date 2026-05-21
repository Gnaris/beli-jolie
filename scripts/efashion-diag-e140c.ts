/**
 * Diagnostic complet : pourquoi le stock du produit E140C ne se met pas à jour
 * sur eFashion ?
 *
 * Lit l'état local (BDD) + l'état eFashion + simule ce que le worker ferait.
 */

import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionListProducts } from "@/lib/efashion-api";
import { efashionFetch } from "@/lib/efashion-client";
import { prisma } from "@/lib/prisma";

const REF = "E140C";

async function main() {
  await ensureEfashionSession();
  console.log("══════ 1) État dans la BDD BJ ══════\n");
  const product = await prisma.product.findFirst({
    where: { reference: REF },
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      efashionReferenceBase: true,
      efashionLastSyncSnapshot: true,
      efashionLastRefreshedAt: true,
      colors: {
        select: {
          id: true,
          colorId: true,
          efashionProductId: true,
          unitPrice: true,
          weight: true,
          stock: true,
          saleType: true,
          packQuantity: true,
          disabled: true,
          color: { select: { id: true, name: true, efashionColorId: true } },
          variantSizes: {
            select: {
              quantity: true,
              size: { select: { id: true, name: true, efashionDeclinaisonId: true } },
            },
          },
        },
      },
    },
  });

  if (!product) {
    console.log(`❌ Produit ${REF} introuvable en BDD locale`);
    return;
  }

  console.log(`Produit BJ : ${product.reference} — ${product.name}`);
  console.log(`Status     : ${product.status}`);
  console.log(`efashionReferenceBase : ${product.efashionReferenceBase ?? "(NULL)"}`);
  console.log(`efashionLastRefreshedAt : ${product.efashionLastRefreshedAt}`);
  console.log(`efashionLastSyncSnapshot : ${product.efashionLastSyncSnapshot ? "présent" : "(NULL)"}`);

  console.log(`\nCouleurs :`);
  for (const c of product.colors) {
    console.log(`  • Couleur BJ "${c.color?.name}" (id=${c.color?.id})`);
    console.log(`    efashionColorId   = ${c.color?.efashionColorId ?? "(NULL)"}`);
    console.log(`    efashionProductId = ${c.efashionProductId ?? "(NULL)"}`);
    console.log(`    stock=${c.stock} unitPrice=${c.unitPrice} disabled=${c.disabled}`);
    for (const vs of c.variantSizes) {
      console.log(`      taille "${vs.size.name}" quantity=${vs.quantity}  efashionDeclId=${vs.size.efashionDeclinaisonId ?? "(NULL)"}`);
    }
  }

  if (product.efashionLastSyncSnapshot) {
    console.log(`\nSnapshot précédent :`);
    console.log(JSON.stringify(product.efashionLastSyncSnapshot, null, 2));
  }

  if (!product.efashionReferenceBase) {
    console.log("\n⚠ Le produit n'est pas lié à eFashion. Pas d'update possible.");
    return;
  }

  console.log("\n══════ 2) État côté eFashion ══════\n");
  const list = await efashionListProducts({
    idVendeur: 2017,
    reference: product.efashionReferenceBase,
    premelFilter: "tous",
    take: 30,
  });
  const items = list.items.filter((it) => it.reference_base === product.efashionReferenceBase);
  console.log(`${items.length} variantes côté eFashion (filtre exact sur reference_base) :`);
  for (const it of items) {
    console.log(
      `  - id=${it.id_produit}  couleur=${it.couleur}(${it.id_couleur})  stock_value=${it.stock_value}  stock_renseigne=${it.stock_renseigne}  visible=${it.visible}  nb_photos=${it.nb_photos}`,
    );
  }

  console.log("\n══════ 3) Détails du stock par taille ══════\n");
  for (const c of product.colors) {
    if (!c.efashionProductId) continue;
    const r = await efashionFetch(`/shootings/shooting/`, { method: "GET" });
    // On essaie aussi via les vraies entrées : la liste ci-dessus donne déjà stock_value total.
    console.log(`Couleur ${c.color?.name} (id_produit eFashion=${c.efashionProductId}) — stock par taille :`);
    // Reconstruction de ce que le worker enverrait
    const stockByTaille: Record<string, number> = {};
    if (c.saleType === "UNIT" && c.variantSizes.length > 0) {
      for (const vs of c.variantSizes) {
        stockByTaille[vs.size.name] = vs.quantity ?? 0;
      }
    } else {
      stockByTaille[c.variantSizes[0]?.size.name ?? "TU"] = c.stock;
    }
    console.log(`  → stockByTaille (ce que la sync construirait) :`, stockByTaille);
  }

  console.log("\n══════ 4) Tentative de PUSH directe (simulation worker) ══════\n");
  // On va appeler efashionSaveProduitStocks directement, comme le ferait le worker.
  const { efashionSaveProduitStocks } = await import("@/lib/efashion-api-write");
  for (const c of product.colors) {
    if (!c.efashionProductId || !c.color?.efashionColorId) {
      console.log(`  ⚠ Couleur "${c.color?.name}" — efashionProductId ou efashionColorId manquant, skip`);
      continue;
    }
    const items: Array<{ id_couleur: number; value: number; taille: string | null }> = [];
    if (c.saleType === "UNIT" && c.variantSizes.length > 0) {
      for (const vs of c.variantSizes) {
        items.push({ id_couleur: c.color.efashionColorId, value: vs.quantity ?? 0, taille: vs.size.name === "TU" ? null : vs.size.name });
      }
    } else {
      items.push({ id_couleur: c.color.efashionColorId, value: c.stock, taille: null });
    }
    console.log(`  → push pour ${c.color.name}, id_produit=${c.efashionProductId} :`, items);
    try {
      const res = await efashionSaveProduitStocks({ id_produit: c.efashionProductId, items });
      console.log(`     saveProduitStocks → ${res}`);
    } catch (err) {
      console.log(`     ❌ Erreur : ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("\n══════ 5) Vérification après push ══════\n");
  const list2 = await efashionListProducts({
    idVendeur: 2017,
    reference: product.efashionReferenceBase,
    premelFilter: "tous",
    take: 30,
  });
  for (const it of list2.items.filter((it) => it.reference_base === product.efashionReferenceBase)) {
    console.log(`  - id=${it.id_produit}  couleur=${it.couleur}  stock_value=${it.stock_value}  stock_renseigne=${it.stock_renseigne}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
