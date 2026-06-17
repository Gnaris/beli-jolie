/**
 * Force le rafraîchissement des images de variantes sur Faire pour un produit.
 *
 * Pourquoi : un PATCH /products/{id} avec `variants[].images` ne semble pas
 * remplacer les images de variantes existantes côté Faire (elles restent
 * cachées dans la version d'origine — typiquement webp d'avant la conversion
 * JPEG). On supprime donc TOUTES les images de chaque variante via DELETE,
 * puis on relance un PATCH pour qu'elles soient re-cachées avec les nouvelles
 * URLs (jpeg, taille minWidth=1000).
 *
 * Usage : npx tsx scripts/faire-refresh-variant-images.ts <productId>
 * Optionnel : --dry pour voir sans rien supprimer.
 */
import { PrismaClient } from "@prisma/client";
import { faireFetch } from "@/lib/faire-api";
import { faireUpdateProduct } from "@/lib/faire-update";

const PRODUCT_ID = process.argv[2];
const DRY_RUN = process.argv.includes("--dry");

interface FaireVariantImage {
  id?: string;
  url?: string;
}
interface FaireVariant {
  id?: string;
  sku?: string;
  options?: { name: string; value: string }[];
  images?: FaireVariantImage[];
}

async function main() {
  if (!PRODUCT_ID) {
    console.error("Usage : npx tsx scripts/faire-refresh-variant-images.ts <productId> [--dry]");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const prod = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: { reference: true, faireProductId: true },
    });
    if (!prod?.faireProductId) {
      console.error("Produit pas lié à Faire.");
      process.exit(1);
    }
    console.log(`Produit ${prod.reference} (Faire ${prod.faireProductId})`);

    // 1) Récupère l'état Faire
    const getRes = await faireFetch(`/products/${encodeURIComponent(prod.faireProductId)}`, {
      method: "GET",
    });
    if (!getRes.ok) {
      console.error("GET échec :", getRes.status);
      process.exit(1);
    }
    const data = (await getRes.json()) as { variants?: FaireVariant[] };

    let totalImages = 0;
    for (const v of data.variants ?? []) {
      totalImages += v.images?.length ?? 0;
    }
    console.log(`\n${data.variants?.length ?? 0} variante(s), ${totalImages} image(s) à supprimer`);

    if (DRY_RUN) {
      for (const v of data.variants ?? []) {
        const colorLabel = v.options?.find((o) => o.name === "Color")?.value ?? "?";
        console.log(`  • ${colorLabel} (${v.id}) — ${v.images?.length ?? 0} image(s):`);
        for (const img of v.images ?? []) {
          console.log(`     - ${img.id} ${img.url?.slice(0, 80)}...`);
        }
      }
      console.log("\n--dry : aucune suppression effectuée.");
      return;
    }

    // 2) DELETE chaque image de chaque variante
    for (const v of data.variants ?? []) {
      if (!v.id) continue;
      const colorLabel = v.options?.find((o) => o.name === "Color")?.value ?? "?";
      for (const img of v.images ?? []) {
        if (!img.id) continue;
        const url = `/products/${encodeURIComponent(prod.faireProductId)}/variants/${encodeURIComponent(v.id)}/images/${encodeURIComponent(img.id)}`;
        const delRes = await faireFetch(url, { method: "DELETE" });
        if (!delRes.ok && delRes.status !== 404) {
          const txt = await delRes.text().catch(() => "");
          console.error(`  ❌ ${colorLabel} ${img.id} HTTP ${delRes.status} ${txt.slice(0, 200)}`);
        } else {
          console.log(`  ✅ ${colorLabel} ${img.id} supprimée (HTTP ${delRes.status})`);
        }
      }
    }

    // 3) Force un sync : la prochaine sync va envoyer les nouvelles images
    // dans le PATCH consolidé. On reset le snapshot pour que diff considère
    // tout comme changé.
    await prisma.product.update({
      where: { id: PRODUCT_ID },
      data: { faireSyncRequired: true },
    });

    console.log("\nDéclenchement de la sync Faire (PATCH consolidé)…");
    const syncRes = await faireUpdateProduct(PRODUCT_ID);
    console.log("Sync :", JSON.stringify(syncRes, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
