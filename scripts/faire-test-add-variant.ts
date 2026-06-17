/**
 * Test direct du flow « ajout d'une couleur sur un produit Faire déjà lié ».
 * Sans passer par la queue marketplace : appel direct à `faireUpdateProduct`.
 *
 * Usage :
 *   npx tsx scripts/faire-test-add-variant.ts [productId]
 *
 * Par défaut : F137 (cmpif79hh003p4minxk6qefgx).
 */
import { PrismaClient } from "@prisma/client";
import { faireUpdateProduct } from "@/lib/faire-update";

const PRODUCT_ID = process.argv[2] ?? "cmpif79hh003p4minxk6qefgx";

async function main() {
  const prisma = new PrismaClient();
  try {
    const prod = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: {
        id: true,
        reference: true,
        faireProductId: true,
        faireSyncRequired: true,
        colors: { select: { id: true, faireVariantId: true, color: { select: { name: true } } } },
      },
    });
    if (!prod) {
      console.error("Produit introuvable :", PRODUCT_ID);
      process.exit(1);
    }
    console.log("=== AVANT ===");
    console.log("Reference :", prod.reference);
    console.log("faireProductId :", prod.faireProductId);
    console.log("faireSyncRequired :", prod.faireSyncRequired);
    console.log("Couleurs :");
    for (const c of prod.colors) {
      console.log(`  - ${c.color?.name ?? "?"}  bjId=${c.id}  faireVid=${c.faireVariantId ?? "(aucun)"}`);
    }
    console.log("");

    console.log("=== APPEL faireUpdateProduct ===");
    const res = await faireUpdateProduct(PRODUCT_ID);
    console.log("Résultat :", JSON.stringify(res, null, 2));
    console.log("");

    const after = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: {
        faireSyncRequired: true,
        colors: { select: { id: true, faireVariantId: true, color: { select: { name: true } } } },
      },
    });
    console.log("=== APRÈS ===");
    console.log("faireSyncRequired :", after?.faireSyncRequired);
    for (const c of after?.colors ?? []) {
      console.log(`  - ${c.color?.name ?? "?"}  faireVid=${c.faireVariantId ?? "(aucun)"}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
