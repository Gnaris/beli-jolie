import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: "cmuy7hc4g0001lndxxwtpmi5z" },
    select: { tenantId: true, items: { select: { productRef: true, colorName: true } } },
  });
  if (!order) {
    console.log("ORDER NOT FOUND");
    return;
  }

  for (const it of order.items) {
    const products = await prisma.product.findMany({
      where: { tenantId: order.tenantId, reference: it.productRef },
      include: {
        colors: {
          where: it.colorName
            ? { color: { is: { name: it.colorName } } }
            : undefined,
          include: {
            images: { orderBy: { order: "asc" } },
            color: { select: { name: true } },
          },
        },
      },
    });
    console.log(`\n[${it.productRef} / ${it.colorName}] → ${products.length} produit(s) matching`);
    for (const p of products) {
      console.log(`  Product ${p.id} status=${p.status} colors=${p.colors.length}`);
      for (const pc of p.colors) {
        console.log(`    ProductColor ${pc.id} (${pc.color.name}) → ${pc.images.length} image(s)`);
        for (const img of pc.images) {
          const rel = img.path.startsWith("/") ? img.path.slice(1) : img.path;
          const abs = path.join(process.cwd(), "public", rel);
          let diskOk: string;
          try {
            await fs.access(abs);
            diskOk = "OK";
          } catch {
            diskOk = "MISSING";
          }
          console.log(`      · ${img.path} [${diskOk}]`);
        }
      }
    }
  }
}

main().finally(() => prisma.$disconnect());
