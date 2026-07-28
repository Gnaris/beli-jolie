/**
 * Diagnostic ponctuel : dump de l'état brut d'un produit côté eFashion.
 * Usage : npx tsx scripts/efashion-check-ps3.ts [reference_base] [tenant_slug]
 * Défaut : PS3, tenant beliandjolie
 *
 * IMPORTANT : hors requête HTTP, il faut wrapper l'appel dans `tenantALS.run`
 * sinon les caches d'auth eFashion partent sur le mauvais tenant (le premier
 * cache-hit ISSYMA/BJ selon la course).
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { efashionListByReferenceBaseExact, efashionGetMe } from "@/lib/efashion-api";

async function main() {
  const ref = process.argv[2] || "PS3";
  const tenantSlug = process.argv[3] || "beliandjolie";
  const tenants = await prisma.tenant.findMany({ where: { isActive: true } });
  const tenant = tenants.find((t) => t.slug === tenantSlug);
  if (!tenant) {
    throw new Error(
      `Tenant "${tenantSlug}" introuvable. Actifs : ${tenants.map((t) => t.slug).join(", ")}`,
    );
  }

  await tenantALS.run(tenant.id, async () => {
    const me = await efashionGetMe();
    const items = await efashionListByReferenceBaseExact({
      idVendeur: me.id_vendeur,
      referenceBase: ref,
      premelFilter: "tous",
    });
    console.log(`\n=== eFashion state for reference_base="${ref}" (tenant=${tenant.slug}) ===`);
    console.log(`vendor: ${me.id_vendeur}`);
    console.log(`items found: ${items.length}`);
    if (items.length === 0) {
      console.log("(aucun produit ne matche cette référence côté eFashion)");
      return;
    }
    console.table(
      items.map((it) => ({
        id_produit: it.id_produit,
        reference: it.reference,
        reference_base: it.reference_base,
        couleur: it.couleur,
        id_couleur: it.id_couleur,
        visible: it.visible,
        supprimer: it.supprimer,
        stock_value: it.stock_value,
        nb_photos: it.nb_photos,
        premel: it.premel ?? "(null)",
      })),
    );
  });
}

main().catch((err) => {
  console.error("[efashion-check-ps3] failed:", err);
  process.exit(1);
});
