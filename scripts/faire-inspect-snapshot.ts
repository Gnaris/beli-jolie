import { PrismaClient } from "@prisma/client";

const PRODUCT_ID = process.argv[2] ?? "cmpif79hh003p4minxk6qefgx";

async function main() {
  const prisma = new PrismaClient();
  try {
    const r = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { reference: true, faireLastSyncSnapshot: true },
    });
    if (!r) {
      console.error("Produit introuvable");
      return;
    }
    const snap = r.faireLastSyncSnapshot as
      | { schemaVersion?: number; variants?: Record<string, { sku: string; faireVariantId?: string | null; colorOption?: string }> }
      | null;
    console.log("Reference :", r.reference);
    console.log("Snapshot schemaVersion :", snap?.schemaVersion);
    console.log("Variants in snapshot :");
    for (const [sku, v] of Object.entries(snap?.variants ?? {})) {
      console.log(`  - ${v.colorOption ?? "?"}  sku=${sku}  faireVariantId=${v.faireVariantId ?? "(null)"}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
