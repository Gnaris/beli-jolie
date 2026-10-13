/**
 * One-shot : rattrape `imagePath` sur les 3 OrderItem de la commande
 * cmuy7hc4g0001lndxxwtpmi5z (ancien bug, items créés avec imagePath=null).
 *
 * Reprend la 1ʳᵉ image de la ProductColor qui correspond
 * (productRef, colorName) et pose son `.path` sur l'OrderItem.
 *
 * Idempotent : si l'OrderItem a déjà un imagePath, on skip.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: "cmuy7hc4g0001lndxxwtpmi5z" },
    select: {
      tenantId: true,
      items: {
        select: { id: true, productRef: true, colorName: true, imagePath: true },
      },
    },
  });
  if (!order) {
    console.error("ORDER NOT FOUND");
    process.exit(1);
  }
  console.log(APPLY ? "MODE : APPLY" : "MODE : dry-run (ajouter --apply pour écrire)");

  for (const it of order.items) {
    if (it.imagePath) {
      console.log(`SKIP ${it.productRef}/${it.colorName} (déjà renseigné)`);
      continue;
    }
    const product = await prisma.product.findFirst({
      where: { tenantId: order.tenantId, reference: it.productRef },
      select: {
        colors: {
          where: it.colorName
            ? { color: { is: { name: it.colorName } } }
            : undefined,
          include: {
            images: { orderBy: { order: "asc" }, take: 1 },
          },
        },
      },
    });
    const pc = product?.colors.find((c) => c.images.length > 0);
    const img = pc?.images[0]?.path ?? null;
    if (!img) {
      console.log(`MISS ${it.productRef}/${it.colorName} (aucune image trouvée côté produit)`);
      continue;
    }
    console.log(`FIX  ${it.productRef}/${it.colorName} → ${img}`);
    if (APPLY) {
      await prisma.orderItem.update({ where: { id: it.id }, data: { imagePath: img } });
    }
  }
}

main().finally(() => prisma.$disconnect());
