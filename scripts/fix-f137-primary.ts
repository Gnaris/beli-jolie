import { prisma } from "@/lib/prisma";

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: "F137" },
    select: { id: true, primaryColorId: true },
  });
  if (!p?.primaryColorId) {
    console.log("Pas de primaryColorId");
    return;
  }
  await prisma.$transaction([
    prisma.productColor.updateMany({
      where: { productId: p.id, NOT: { colorId: p.primaryColorId } },
      data: { isPrimary: false },
    }),
    prisma.productColor.updateMany({
      where: { productId: p.id, colorId: p.primaryColorId },
      data: { isPrimary: true },
    }),
  ]);
  const after = await prisma.productColor.findMany({
    where: { productId: p.id },
    select: { isPrimary: true, color: { select: { name: true } } },
  });
  console.log("Après fix:");
  for (const c of after) console.log("  ", c.color?.name, "| isPrimary=" + c.isPrimary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
