/**
 * Détecte les variantes orphelines côté Faire (qui n'existent plus en BDD)
 * et les supprime via `DELETE /products/{id}/variants/{vid}`.
 *
 * Utilisé une fois pour rattraper les suppressions silencieuses dues à
 * l'ancien bug : le snapshot ne stockait pas `faireVariantId`, donc le
 * DELETE était sauté.
 *
 * Usage :
 *   npx tsx scripts/faire-cleanup-orphan-variants.ts <productId>
 *   npx tsx scripts/faire-cleanup-orphan-variants.ts <productId> --dry
 */
import { PrismaClient } from "@prisma/client";
import { faireFetch } from "@/lib/faire-api";

const PRODUCT_ID = process.argv[2];
const DRY_RUN = process.argv.includes("--dry");

async function main() {
  if (!PRODUCT_ID) {
    console.error("Usage : npx tsx scripts/faire-cleanup-orphan-variants.ts <productId> [--dry]");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const prod = await prisma.product.findUnique({
      where: { id: PRODUCT_ID },
      select: {
        id: true,
        reference: true,
        faireProductId: true,
        colors: { select: { id: true, faireVariantId: true, color: { select: { name: true } } } },
      },
    });
    if (!prod) {
      console.error("Produit introuvable :", PRODUCT_ID);
      process.exit(1);
    }
    if (!prod.faireProductId) {
      console.error("Produit pas lié à Faire, rien à nettoyer.");
      process.exit(1);
    }

    console.log(`Produit : ${prod.reference} (Faire id ${prod.faireProductId})`);
    const bjFaireIds = new Set<string>(
      prod.colors.map((c) => c.faireVariantId).filter((id): id is string => !!id),
    );
    console.log("\nVariantes côté BDD (avec faireVariantId) :");
    for (const c of prod.colors) {
      console.log(`  - ${c.color?.name ?? "?"}  faireVid=${c.faireVariantId ?? "(aucun)"}`);
    }

    console.log("\nFetch /products/" + prod.faireProductId + "…");
    const res = await faireFetch(`/products/${encodeURIComponent(prod.faireProductId)}`, {
      method: "GET",
    });
    if (!res.ok) {
      console.error("Faire GET échec :", res.status, await res.text().catch(() => ""));
      process.exit(1);
    }
    const data = (await res.json()) as {
      variants?: { id?: string; sku?: string; options?: { name: string; value: string }[]; lifecycle_state?: string }[];
    };
    const faireVariants = (data.variants ?? []).filter(
      (v) => v.id && v.lifecycle_state !== "DELETED",
    );
    console.log(`\nFaire a ${faireVariants.length} variante(s) active(s) :`);
    for (const v of faireVariants) {
      const colorLabel = v.options?.find((o) => o.name === "Color")?.value ?? "?";
      console.log(`  - ${colorLabel}  faireVid=${v.id}  sku=${v.sku ?? "?"}`);
    }

    const orphans = faireVariants.filter((v) => v.id && !bjFaireIds.has(v.id));
    if (orphans.length === 0) {
      console.log("\n✅ Aucune variante orpheline détectée.");
      return;
    }

    console.log(`\n⚠️ ${orphans.length} orpheline(s) à supprimer côté Faire :`);
    for (const v of orphans) {
      const colorLabel = v.options?.find((o) => o.name === "Color")?.value ?? "?";
      console.log(`  - ${colorLabel}  faireVid=${v.id}`);
    }

    if (DRY_RUN) {
      console.log("\n--dry : aucune suppression effectuée. Re-lancer sans --dry.");
      return;
    }

    for (const v of orphans) {
      const url = `/products/${encodeURIComponent(prod.faireProductId)}/variants/${encodeURIComponent(v.id!)}`;
      console.log(`DELETE ${url}…`);
      const delRes = await faireFetch(url, { method: "DELETE" });
      if (!delRes.ok && delRes.status !== 404) {
        const txt = await delRes.text().catch(() => "");
        console.error(`  ❌ échec HTTP ${delRes.status} ${txt.slice(0, 200)}`);
      } else {
        console.log(`  ✅ OK (HTTP ${delRes.status})`);
      }
    }
    console.log("\nTerminé.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
