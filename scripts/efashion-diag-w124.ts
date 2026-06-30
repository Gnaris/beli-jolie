/**
 * Diagnostic ponctuel : que voit eFashion pour le groupe W124 ?
 * On compare la liste retournée par listProducts/reference_base avec ce
 * que la base BJ a comme efashionProductId pour ce produit.
 *
 * Usage : npx tsx scripts/efashion-diag-w124.ts
 */

import { prisma } from "@/lib/prisma";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";

async function main() {
  const ref = "W124";

  const product = await prisma.product.findFirst({
    where: { efashionReferenceBase: ref },
    select: {
      id: true,
      reference: true,
      efashionReferenceBase: true,
      colors: {
        select: {
          id: true,
          efashionProductId: true,
          disabled: true,
          isPrimary: true,
          saleType: true,
          color: { select: { name: true, efashionColorId: true } },
        },
        orderBy: { isPrimary: "desc" },
      },
    },
  });
  if (!product) {
    console.log(`Aucun produit BJ avec efashionReferenceBase = ${ref}`);
    return;
  }

  console.log(`\nProduit BJ ${product.reference} (id=${product.id})`);
  console.log("Couleurs BJ :");
  for (const pc of product.colors) {
    console.log(
      `  - pc=${pc.id} | saleType=${pc.saleType} | disabled=${pc.disabled} | isPrimary=${pc.isPrimary} | efashionProductId=${pc.efashionProductId} | color=${pc.color?.name ?? "—"} (efColorId=${pc.color?.efashionColorId ?? "—"})`,
    );
  }

  const me = await efashionGetMe();
  console.log(
    `\nVendeur eFashion : ${me.nomBoutique} (id_vendeur=${me.id_vendeur})`,
  );

  const items = await efashionListByReferenceBaseExact({
    idVendeur: me.id_vendeur,
    referenceBase: ref,
    premelFilter: "tous",
  });
  console.log(
    `\nlistByReferenceBaseExact('${ref}', premelFilter=tous) → ${items.length} item(s) :`,
  );
  for (const it of items) {
    console.log(
      `  - id_produit=${it.id_produit} | reference=${it.reference} | reference_base=${it.reference_base} | couleur=${it.couleur} | id_couleur=${(it as { id_couleur?: number }).id_couleur ?? "—"} | premel=${(it as { premel?: string }).premel ?? "—"} | main=${(it as { main?: boolean }).main ?? "—"} | visible=${(it as { visible?: boolean }).visible ?? "—"} | suppr=${(it as { suppr?: boolean }).suppr ?? "—"}`,
    );
  }

  const liveIds = new Set(items.map((it) => it.id_produit));
  const bjLinkedIds = product.colors
    .map((c) => c.efashionProductId)
    .filter((id): id is number => id !== null);
  const missing = bjLinkedIds.filter((id) => !liveIds.has(id));

  console.log(
    `\nIDs BJ liés à eFashion : [${bjLinkedIds.join(", ")}]`,
  );
  console.log(
    `IDs absents de la liste eFashion : [${missing.join(", ") || "aucun"}]`,
  );

  if (missing.length > 0) {
    console.log("\nDétail des IDs absents — tentative de fetch individuel :");
    const { efashionListProducts } = await import("@/lib/efashion-api");
    for (const id of missing) {
      console.log(`\n  → id_produit=${id}`);
      try {
        // Cherche en remontant sans filtre reference pour voir si l'item
        // existe mais avec une autre reference_base / un statut bloquant.
        // On essaye d'abord par reference exacte de la fiche.
        const it = items.find((x) => x.id_produit === id);
        if (it) {
          console.log(`    ✓ trouvé dans le bucket : ${JSON.stringify(it)}`);
        } else {
          // Tentative générique : on liste les 5 produits dont la reference
          // contient l'id (peu probable) ou on l'écrit en sortie.
          const res = await efashionListProducts({
            idVendeur: me.id_vendeur,
            take: 5,
            reference: String(id),
            premelFilter: "tous",
          });
          console.log(
            `    listProducts(reference=${id}) → ${res.items.length} item(s) : ${JSON.stringify(
              res.items.map((x) => ({
                id_produit: x.id_produit,
                reference: x.reference,
                reference_base: x.reference_base,
                couleur: x.couleur,
              })),
            )}`,
          );
        }
      } catch (err) {
        console.log(
          `    ERR : ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
