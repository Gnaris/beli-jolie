/**
 * Diagnostic F137 — compare ce qui est en BDD locale vs ce qui est chez eFashion.
 * Usage : npx tsx scripts/efashion-inspect-f137.ts
 */

import { prisma } from "@/lib/prisma";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { loadEfashionMarkup, computeEfashionPrice } from "@/lib/efashion-pricing";

const REFERENCE = "F137";

async function main() {
  const local = await prisma.product.findFirst({
    where: { reference: REFERENCE },
    select: {
      id: true,
      reference: true,
      name: true,
      description: true,
      status: true,
      efashionReferenceBase: true,
      efashionLastSyncSnapshot: true,
      colors: {
        select: {
          id: true,
          saleType: true,
          unitPrice: true,
          weight: true,
          stock: true,
          packQuantity: true,
          disabled: true,
          efashionProductId: true,
          isPrimary: true,
          color: { select: { name: true, efashionColorId: true } },
        },
        orderBy: { isPrimary: "desc" },
      },
    },
  });

  if (!local) {
    console.log(`❌ Aucun produit avec reference="${REFERENCE}" en BDD locale.`);
    process.exit(1);
  }

  console.log(`\n=== F137 — BDD locale ===`);
  console.log(`id        : ${local.id}`);
  console.log(`name      : ${local.name}`);
  console.log(`status    : ${local.status}`);
  console.log(`efashionReferenceBase : ${local.efashionReferenceBase ?? "null"}`);
  console.log(`Couleurs (${local.colors.length}) :`);

  const markup = await loadEfashionMarkup();
  console.log(`Markup eFashion : type=${markup.type} value=${markup.value} rounding=${markup.rounding}`);

  for (const c of local.colors) {
    const expectedEfPrice = computeEfashionPrice({
      basePrice: Number(c.unitPrice),
      isPack: c.saleType === "PACK",
      packQuantity: c.packQuantity,
      markup,
    });
    console.log(
      `  ${c.isPrimary ? "★" : " "} ${c.color?.name?.padEnd(15)} ` +
        `local=${Number(c.unitPrice).toFixed(2)}€  expected_efashion=${expectedEfPrice}€  ` +
        `efId=${c.efashionProductId ?? "null"}  saleType=${c.saleType}`,
    );
  }

  const snap = local.efashionLastSyncSnapshot as
    | { variants?: Array<{ efashionProductId: number; prix: number }> }
    | null;
  if (snap?.variants) {
    console.log(`\n=== Snapshot précédent (ce qu'on a envoyé la dernière fois) ===`);
    for (const v of snap.variants) {
      console.log(`  efId=${v.efashionProductId}  prix=${v.prix}€`);
    }
  } else {
    console.log(`\n(Pas de snapshot précédent)`);
  }

  console.log(`\n=== F137 — côté eFashion (live) ===`);
  await ensureEfashionSession();
  const me = await efashionGetMe();
  const refBase = local.efashionReferenceBase ?? REFERENCE;

  let found = null as Awaited<ReturnType<typeof efashionListProducts>> | null;
  for (const filter of ["en_ligne", "brouillon", "tous"] as const) {
    const res = await efashionListProducts({
      idVendeur: me.id_vendeur,
      take: 100,
      reference: refBase,
      premelFilter: filter,
    });
    const exact = res.items.filter(
      (it) => (it.reference_base ?? "").toLowerCase().trim() === refBase.toLowerCase().trim(),
    );
    if (exact.length > 0) {
      found = { items: exact, total: res.total };
      console.log(`(premelFilter="${filter}" — ${exact.length} ligne(s))`);
      break;
    }
  }

  if (!found) {
    console.log(`❌ Aucune ligne eFashion avec reference_base="${refBase}"`);
    process.exit(0);
  }

  for (const item of found.items) {
    console.log(
      `  ${item.main ? "★" : " "} efId=${item.id_produit}  couleur=${item.couleur.padEnd(15)} ` +
        `prix=${item.prix}€  visible=${item.visible}  supprimer=${item.supprimer}  main=${item.main}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
