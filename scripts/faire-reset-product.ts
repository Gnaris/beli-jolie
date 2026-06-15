/**
 * Supprime un produit côté Faire + reset le mapping côté BDD.
 * Utilisé pour re-tester un publish depuis zéro.
 *
 * Usage : npx tsx scripts/faire-reset-product.ts <productId>
 */
import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { faireFetch } from "@/lib/faire-api";

const PRODUCT_ID = process.argv[2] ?? "cmpif79hh003p4minxk6qefgx";

async function main() {
  const prisma = new PrismaClient();
  try {
    const prod = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { id: true, reference: true, faireProductId: true },
    });
    if (!prod) {
      console.log("Produit BDD introuvable.");
      return;
    }
    if (!prod.faireProductId) {
      console.log("Pas de faireProductId, rien à faire côté Faire.");
    } else {
      console.log(`DELETE /products/${prod.faireProductId}…`);
      const res = await faireFetch(`/products/${prod.faireProductId}`, { method: "DELETE" });
      console.log("Faire status:", res.status);
      const text = await res.text().catch(() => "");
      if (text) console.log("Body:", text.slice(0, 300));
    }

    await prisma.product.update({
      where: { id: PRODUCT_ID },
      data: {
        faireProductId: null,
        faireLastSyncSnapshot: Prisma.DbNull,
        faireSyncRequired: false,
      },
    });
    await prisma.productColor.updateMany({
      where: { productId: PRODUCT_ID },
      data: { faireVariantId: null },
    });
    console.log("BDD reset OK.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
