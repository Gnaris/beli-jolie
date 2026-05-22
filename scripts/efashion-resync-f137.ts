/**
 * Test du correctif prix par couleur sur F137 :
 *  1. Lance efashionUpdateProductInPlace(forceFullSync=true)
 *  2. Relit l'état chez eFashion
 *  3. Compare avec ce qu'on a en BDD locale
 */

import { prisma } from "@/lib/prisma";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";

const REFERENCE = "F137";

async function main() {
  const local = await prisma.product.findFirst({
    where: { reference: REFERENCE },
    select: {
      id: true,
      efashionReferenceBase: true,
      colors: {
        select: {
          unitPrice: true,
          efashionProductId: true,
          isPrimary: true,
          color: { select: { name: true } },
        },
      },
    },
  });
  if (!local) throw new Error("F137 introuvable en BDD");

  console.log(`\n--- BDD locale ---`);
  for (const c of local.colors) {
    console.log(
      `  ${c.isPrimary ? "★" : " "} ${c.color?.name?.padEnd(10)} ` +
        `local=${Number(c.unitPrice).toFixed(2)}€  efId=${c.efashionProductId}`,
    );
  }

  console.log(`\n--- Lancement de efashionUpdateProductInPlace(forceFullSync=true) ---`);
  const res = await efashionUpdateProductInPlace(local.id, { forceFullSync: true });
  console.log(`Résultat :`, res);

  console.log(`\n--- Relecture eFashion (live) ---`);
  await ensureEfashionSession();
  const me = await efashionGetMe();
  const list = await efashionListProducts({
    idVendeur: me.id_vendeur,
    take: 100,
    reference: local.efashionReferenceBase ?? REFERENCE,
    premelFilter: "en_ligne",
  });
  for (const it of list.items) {
    if (
      (it.reference_base ?? "").toLowerCase().trim() !==
      (local.efashionReferenceBase ?? REFERENCE).toLowerCase().trim()
    ) {
      continue;
    }
    console.log(
      `  ${it.main ? "★" : " "} efId=${it.id_produit}  couleur=${it.couleur.padEnd(10)} ` +
        `prix=${it.prix}€  visible=${it.visible}  main=${it.main}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
