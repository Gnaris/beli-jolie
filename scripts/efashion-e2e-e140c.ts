/**
 * Test end-to-end : on simule exactement ce que fait le worker quand la cliente
 * coche eFashion à l'enregistrement de E140C.
 *
 * Étapes :
 *   1. Lit l'état BDD local de E140C + état eFashion + liaison
 *   2. Met des stocks au hasard sur chaque couleur dans la BDD
 *   3. Appelle efashionUpdateProductInPlace (la fonction exécutée par le worker)
 *   4. Vérifie ce que eFashion a réellement reçu
 *   5. Affiche un verdict
 */

import { prisma } from "@/lib/prisma";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionListProducts } from "@/lib/efashion-api";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";

function randomStock(): number {
  return Math.floor(Math.random() * 100); // 0-99
}

async function main() {
  await ensureEfashionSession();
  console.log("══════ 0) État BDD avant ══════\n");
  const before = await prisma.product.findFirst({
    where: { reference: "E140C" },
    select: {
      id: true,
      efashionReferenceBase: true,
      efashionLastSyncSnapshot: true,
      colors: {
        select: {
          id: true,
          stock: true,
          efashionProductId: true,
          color: { select: { name: true, efashionColorId: true } },
        },
      },
    },
  });
  if (!before) throw new Error("E140C introuvable");
  if (!before.efashionReferenceBase) throw new Error("E140C n'est pas lié à eFashion");

  console.log(`E140C — id=${before.id}  efashionReferenceBase=${before.efashionReferenceBase}\n`);
  console.log("Liaison :");
  for (const c of before.colors) {
    const ok = c.efashionProductId && c.color?.efashionColorId;
    console.log(
      `  ${ok ? "✓" : "✗"} ${c.color?.name}  stock=${c.stock}  efashionProductId=${c.efashionProductId ?? "(NULL)"}  efashionColorId=${c.color?.efashionColorId ?? "(NULL)"}`,
    );
  }

  const missingLink = before.colors.find((c) => !c.efashionProductId || !c.color?.efashionColorId);
  if (missingLink) {
    console.log(`\n⚠ Liaison incomplète sur ${missingLink.color?.name} — le worker skip silencieusement cette couleur`);
  }

  console.log("\n══════ 1) Modification des stocks avec des valeurs aléatoires ══════\n");
  const newStocks: Record<string, { name: string; stock: number }> = {};
  for (const c of before.colors) {
    const newStock = randomStock();
    newStocks[c.id] = { name: c.color?.name ?? "?", stock: newStock };
    await prisma.productColor.update({
      where: { id: c.id },
      data: { stock: newStock },
    });
    console.log(`  ${c.color?.name} : ${c.stock} → ${newStock}`);
  }

  console.log("\n══════ 2) État côté eFashion AVANT sync ══════\n");
  const efBefore = await efashionListProducts({
    idVendeur: 2017,
    reference: "E140C",
    premelFilter: "tous",
    take: 30,
  });
  for (const it of efBefore.items.filter((it) => it.reference_base === "E140C")) {
    console.log(`  - id=${it.id_produit}  couleur=${it.couleur}  stock_value=${it.stock_value}  visible=${it.visible}`);
  }

  console.log("\n══════ 3) Appel de efashionUpdateProductInPlace (= worker) ══════\n");
  const result = await efashionUpdateProductInPlace(before.id);
  console.log("Résultat :", JSON.stringify(result, null, 2));

  console.log("\n══════ 4) État côté eFashion APRÈS sync ══════\n");
  const efAfter = await efashionListProducts({
    idVendeur: 2017,
    reference: "E140C",
    premelFilter: "tous",
    take: 30,
  });
  for (const it of efAfter.items.filter((it) => it.reference_base === "E140C")) {
    console.log(`  - id=${it.id_produit}  couleur=${it.couleur}  stock_value=${it.stock_value}  visible=${it.visible}`);
  }

  console.log("\n══════ 5) VERDICT ══════\n");
  let allOk = true;
  for (const it of efAfter.items.filter((it) => it.reference_base === "E140C")) {
    const bjColor = before.colors.find((c) => c.efashionProductId === it.id_produit);
    if (!bjColor) continue;
    const expected = newStocks[bjColor.id].stock;
    const actual = it.stock_value;
    const ok = actual === expected;
    if (!ok) allOk = false;
    console.log(`  ${ok ? "✅" : "❌"} ${it.couleur} : attendu=${expected}  eFashion=${actual}`);
  }

  if (allOk) {
    console.log("\n🎉 TOUS LES STOCKS SONT BIEN ARRIVÉS SUR EFASHION");
  } else {
    console.log("\n⚠ Au moins une couleur n'a pas reçu le bon stock");
  }

  console.log("\n══════ 6) État du snapshot après sync ══════\n");
  const after = await prisma.product.findFirst({
    where: { reference: "E140C" },
    select: { efashionLastSyncSnapshot: true, efashionLastRefreshedAt: true },
  });
  console.log("efashionLastRefreshedAt:", after?.efashionLastRefreshedAt);
  if (after?.efashionLastSyncSnapshot) {
    const snap = after.efashionLastSyncSnapshot as { variants?: Array<{ efashionProductId: number; stockByTaille: Record<string, number> }> };
    for (const v of snap.variants ?? []) {
      console.log(`  efashionProductId=${v.efashionProductId} stockByTaille=${JSON.stringify(v.stockByTaille)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(1);
  });
