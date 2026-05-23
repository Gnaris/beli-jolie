/**
 * Debug F137 — cherche toute entrée ProductColorImage liée au produit F137,
 * même via productId direct (au cas où productColorId est null).
 */
import { prisma } from "@/lib/prisma";

async function main() {
  const prod = await prisma.product.findFirst({
    where: { reference: "F137" },
    select: { id: true },
  });
  if (!prod) {
    console.log("F137 introuvable");
    process.exit(1);
  }
  const images = await prisma.productColorImage.findMany({
    where: { productId: prod.id },
    select: {
      id: true,
      path: true,
      order: true,
      colorId: true,
      productColorId: true,
      color: { select: { name: true } },
    },
    orderBy: [{ colorId: "asc" }, { order: "asc" }],
  });
  console.log(`ProductColorImage liées à F137 (productId=${prod.id}) : ${images.length}`);
  for (const img of images) {
    console.log(
      `  id=${img.id}  colorId=${img.colorId} (${img.color?.name})  productColorId=${img.productColorId}  order=${img.order}  path=${img.path}`,
    );
  }

  console.log("\nProductColor de F137 :");
  const colors = await prisma.productColor.findMany({
    where: { productId: prod.id },
    select: { id: true, colorId: true, color: { select: { name: true } } },
  });
  for (const c of colors) {
    console.log(`  ProductColor id=${c.id}  colorId=${c.colorId}  name=${c.color?.name}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
