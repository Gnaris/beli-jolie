import { prisma } from "@/lib/prisma";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";
import { ensureEfashionSession } from "@/lib/efashion-auth";
import { efashionGetMe, efashionListProducts } from "@/lib/efashion-api";

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: "F137" },
    select: { id: true, efashionReferenceBase: true },
  });
  if (!p?.efashionReferenceBase) throw new Error("F137 non lié");

  await ensureEfashionSession();
  const me = await efashionGetMe();

  console.log("=== Avant sync (live eFashion) ===");
  let list = await efashionListProducts({
    idVendeur: me.id_vendeur,
    take: 100,
    reference: p.efashionReferenceBase,
    premelFilter: "en_ligne",
  });
  for (const it of list.items) {
    console.log(`  efId=${it.id_produit} | couleur=${it.couleur} | main=${it.main}`);
  }

  console.log("\n=== Lancement de la sync ===");
  const res = await efashionUpdateProductInPlace(p.id);
  console.log("Résultat:", {
    success: res.success,
    variantsUpdated: res.variantsUpdated,
    imagesUpdatedCount: res.imagesUpdatedCount,
    error: res.error,
  });

  console.log("\n=== Après sync (live eFashion) ===");
  list = await efashionListProducts({
    idVendeur: me.id_vendeur,
    take: 100,
    reference: p.efashionReferenceBase,
    premelFilter: "en_ligne",
  });
  for (const it of list.items) {
    console.log(`  efId=${it.id_produit} | couleur=${it.couleur} | main=${it.main}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
