import { PrismaClient } from "@prisma/client";
import { faireFetch } from "@/lib/faire-api";

const PRODUCT_ID = process.argv[2] ?? "cmpif79hh003p4minxk6qefgx";

async function main() {
  const prisma = new PrismaClient();
  try {
    const p = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { reference: true, faireProductId: true },
    });
    if (!p?.faireProductId) return console.error("Pas de faireProductId.");
    console.log(`GET /products/${p.faireProductId}…\n`);
    const res = await faireFetch(`/products/${encodeURIComponent(p.faireProductId)}`, {
      method: "GET",
    });
    if (!res.ok) {
      console.error("Faire GET failed :", res.status, await res.text());
      return;
    }
    const data = (await res.json()) as {
      id: string;
      images?: { id?: string; url?: string }[];
      variants?: {
        id?: string;
        sku?: string;
        options?: { name: string; value: string }[];
        images?: { id?: string; url?: string }[];
      }[];
    };
    console.log(`Produit Faire ${data.id}`);
    console.log(`\nImages racine (${data.images?.length ?? 0}) :`);
    for (const img of data.images ?? []) {
      console.log(`  - ${img.url}`);
    }
    console.log(`\nVariantes (${data.variants?.length ?? 0}) :`);
    for (const v of data.variants ?? []) {
      const colorLabel = v.options?.find((o) => o.name === "Color")?.value ?? "?";
      console.log(`  • ${colorLabel} (id=${v.id})  sku=${v.sku}`);
      console.log(`    images (${v.images?.length ?? 0}):`);
      for (const img of v.images ?? []) {
        console.log(`      - ${img.url}`);
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
