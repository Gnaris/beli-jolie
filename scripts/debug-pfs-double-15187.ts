/**
 * Confirme le doublon PFS pour ref 15187 : liste les variantes des DEUX
 * produits PFS impliqués (celui pointé par Product.pfsProductId local vs
 * celui retourné par pfsCheckReference).
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { pfsGetVariants, pfsCheckReference } from "@/lib/pfs-api";

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: "issyma" } });
  if (!tenant) throw new Error("Tenant introuvable");

  await tenantALS.run(tenant.id, async () => {
    const product = await prisma.product.findFirst({
      where: { reference: "15187" },
      select: { id: true, pfsProductId: true },
    });
    console.log(`\nProduct.pfsProductId (local BJ) = ${product?.pfsProductId}\n`);

    const checkRef = await pfsCheckReference("15187");
    console.log(`pfsCheckReference("15187").product.id (PFS) = ${checkRef?.product?.id}\n`);

    for (const id of [product!.pfsProductId!, checkRef!.product!.id!]) {
      console.log(`\n=== Variantes du produit PFS ${id} ===`);
      const r = await pfsGetVariants(id);
      const list = r.data ?? [];
      console.log(`Count = ${list.length}`);
      for (const v of list) {
        const c = v.item?.color ?? v.packs?.[0]?.color;
        const type = v.type === "ITEM" ? "UNIT" : "PACK";
        console.log(
          `  ${v.id}  ${type}  ref=${c?.reference}  labelFr=${c?.labels?.fr}  stock=${v.stock_qty}  active=${v.is_active}`,
        );
      }
    }

    console.log(`\n=== pfsCheckReference status/created/updated ===`);
    console.log(JSON.stringify({
      exists: checkRef?.exists,
      productId: checkRef?.product?.id,
      status: checkRef?.product?.status,
      createdAt: checkRef?.product?.created_at,
      updatedAt: checkRef?.product?.updated_at,
    }, null, 2));
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
