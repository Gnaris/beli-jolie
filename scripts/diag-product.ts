process.env.MULTI_TENANT_SCOPE = "off";
import { prisma } from "@/lib/prisma";
import fs from "node:fs/promises";
import path from "node:path";

async function main() {
  const p = await prisma.product.findFirst({
    where: { reference: "PRODUCTTESTANKORSTORE" },
    select: {
      id: true, status: true, ankorsProductId: true,
      colors: {
        select: {
          id: true, saleType: true, stock: true, disabled: true,
          colorId: true,
          color: { select: { name: true } },
          images: { select: { path: true, order: true } },
        },
      },
      colorImages: {
        select: { path: true, order: true, colorId: true },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!p) throw new Error("nope");
  console.log("Produit id:", p.id, "status:", p.status, "ankorsProductId:", p.ankorsProductId);
  console.log("");
  console.log(`Couleurs actives (${p.colors.length}) :`);
  for (const c of p.colors) {
    console.log(`  - ${c.color?.name} (id ${c.id}) UNIT=${c.saleType === "UNIT"} stock=${c.stock} disabled=${c.disabled}`);
    console.log(`    colorId (Color.id) = ${c.colorId}`);
    if (c.images.length === 0) {
      console.log(`    images ProductColor.images: (aucune)`);
    } else {
      for (const im of c.images) {
        const abs = path.join(process.cwd(), "public", im.path.replace(/^\//, ""));
        try { await fs.stat(abs); console.log(`    image: ${im.path} ✓`); }
        catch { console.log(`    image: ${im.path} ✗ (fichier absent sur disque !)`); }
      }
    }
  }
  console.log("");
  console.log(`Images produit (colorImages, ${p.colorImages.length}) :`);
  for (const im of p.colorImages) {
    const abs = path.join(process.cwd(), "public", im.path.replace(/^\//, ""));
    let statMark = "✓";
    try { await fs.stat(abs); } catch { statMark = "✗"; }
    const colorLabel = p.colors.find((c) => c.colorId === im.colorId)?.color?.name ?? "??? ORPHELINE";
    console.log(`  - order=${im.order} colorId=${im.colorId} (${colorLabel}) path=${im.path} ${statMark}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
