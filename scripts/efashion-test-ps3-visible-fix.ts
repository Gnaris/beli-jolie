/**
 * Test local du fix « dérive visible » eFashion sur PS3.
 *
 * 1. Log l'état eFashion AVANT (attendu : visible=false partout).
 * 2. Passe temporairement PS3 en status=ONLINE (nécessaire pour target.visible=true).
 * 3. Appelle efashionUpdateProductInPlace avec forceFullSync=true.
 * 4. Log l'état eFashion APRÈS (attendu : visible=true partout).
 * 5. Remet PS3 en ARCHIVED (état d'origine local).
 *
 * L'appel eFashion tape en réel sur leur API — même API partagée en local et prod.
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { efashionGetMe, efashionListByReferenceBaseExact } from "@/lib/efashion-api";
import { efashionUpdateProductInPlace } from "@/lib/efashion-update";

async function dumpEfashionState(label: string) {
  const me = await efashionGetMe();
  const items = await efashionListByReferenceBaseExact({
    idVendeur: me.id_vendeur,
    referenceBase: "PS3",
    premelFilter: "tous",
  });
  console.log(`\n=== ${label} (vendor ${me.id_vendeur}) ===`);
  console.table(
    items.map((it) => ({
      id_produit: it.id_produit,
      couleur: it.couleur,
      visible: it.visible,
      stock_value: it.stock_value,
      nb_photos: it.nb_photos,
      premel: it.premel,
    })),
  );
  return items;
}

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: "beli-jolie", isActive: true },
  });
  if (!tenant) throw new Error("Tenant beliandjolie introuvable en local");

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference: "PS3" },
      select: { id: true, status: true },
    });
    if (!product) throw new Error("PS3 introuvable en local");

    const originalStatus = product.status;
    console.log(`[test] PS3 status d'origine : ${originalStatus}`);

    await dumpEfashionState("AVANT sync");

    // Bascule temporairement ONLINE pour que target.visible = true.
    console.log("\n[test] Bascule PS3 → ONLINE temporairement");
    await prisma.product.update({
      where: { id: product.id },
      data: { status: "ONLINE" },
    });

    try {
      console.log("[test] Lancement efashionUpdateProductInPlace(forceFullSync=true)...");
      const res = await efashionUpdateProductInPlace(product.id, { forceFullSync: true });
      console.log("[test] Résultat :", JSON.stringify(res, null, 2));

      await dumpEfashionState("APRÈS sync");
    } finally {
      console.log(`\n[test] Restauration PS3 → ${originalStatus}`);
      await prisma.product.update({
        where: { id: product.id },
        data: { status: originalStatus },
      });
    }
  });
}

main()
  .catch((err) => {
    console.error("[test] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
