/**
 * Re-publie PRODUCTTESTANKORSTORE (déjà lié) pour tester le PUT.
 * Simule ce qui se passe quand la cliente clique Rafraîchir.
 */
import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: "PRODUCTTESTANKORSTORE" },
    select: { id: true, tenantId: true, ankorsProductId: true },
  });
  if (!p) throw new Error("Produit PRODUCTTESTANKORSTORE introuvable");
  console.log("productId:", p.id, "ankorsProductId:", p.ankorsProductId);

  await tenantALS.run(p.tenantId, async () => {
    const { publishProductToAnkorstoreBo } = await import(
      "@/app/actions/admin/ankorstore-bo"
    );
    const res = await publishProductToAnkorstoreBo(p.id);
    if (res.success) {
      console.log("✅ Re-publish OK, Ankor productId:", res.ankorProductId);
    } else {
      console.log("❌ Re-publish ÉCHEC:", res.error);
    }
  });
}

main()
  .catch((err) => {
    console.error("Exception:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
