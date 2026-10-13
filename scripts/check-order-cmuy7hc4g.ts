import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

async function main() {
  const o = await prisma.order.findUnique({
    where: { id: "cmuy7hc4g0001lndxxwtpmi5z" },
    include: {
      items: {
        select: {
          id: true,
          productName: true,
          productRef: true,
          colorName: true,
          imagePath: true,
        },
      },
    },
  });
  if (!o) {
    console.log("ORDER NOT FOUND");
    return;
  }
  console.log("tenantId    :", o.tenantId);
  console.log("orderNumber :", o.orderNumber);
  console.log("items       :", o.items.length);
  for (const it of o.items) {
    const img = it.imagePath;
    let diskOk: string;
    if (!img) {
      diskOk = "(imagePath null)";
    } else {
      const rel = img.startsWith("/") ? img.slice(1) : img;
      const abs = path.join(process.cwd(), "public", rel);
      try {
        await fs.access(abs);
        diskOk = "OK";
      } catch {
        diskOk = "MISSING ON DISK: " + abs;
      }
    }
    console.log(
      `  - ${it.productRef} / ${it.colorName} → ${img ?? "(null)"}  [${diskOk}]`,
    );
  }
}

main().finally(() => prisma.$disconnect());
