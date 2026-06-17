import { PrismaClient } from "@prisma/client";

const PRODUCT_ID = process.argv[2] ?? "cmpif79hh003p4minxk6qefgx";

async function main() {
  const prisma = new PrismaClient();
  try {
    const p = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: {
        reference: true,
        primaryColorId: true,
        colors: {
          select: {
            id: true,
            colorId: true,
            color: { select: { id: true, name: true } },
          },
        },
        colorImages: {
          select: { path: true, order: true, colorId: true, productColorId: true },
          orderBy: [{ colorId: "asc" }, { order: "asc" }],
        },
      },
    });
    if (!p) return console.error("Produit introuvable");
    console.log("Reference :", p.reference);
    console.log("primaryColorId :", p.primaryColorId);
    console.log("\nVariantes BJ (ProductColor) :");
    for (const c of p.colors) {
      console.log(`  - ${c.color?.name ?? "?"}  bjId=${c.id}  colorId=${c.colorId ?? "(null)"}`);
    }
    console.log("\nImages (ProductColorImage) :");
    const byColor = new Map<string, typeof p.colorImages>();
    for (const img of p.colorImages) {
      const key = img.colorId;
      if (!byColor.has(key)) byColor.set(key, []);
      byColor.get(key)!.push(img);
    }
    for (const [colorId, imgs] of byColor.entries()) {
      const colorName = p.colors.find((c) => c.colorId === colorId)?.color?.name ?? "(inconnu)";
      console.log(`  Color ${colorName} (id=${colorId}) — ${imgs.length} image(s):`);
      for (const img of imgs) {
        console.log(`    order=${img.order}  productColorId=${img.productColorId ?? "(null)"}  path=${img.path}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
