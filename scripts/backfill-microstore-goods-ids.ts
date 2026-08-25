/**
 * Backfill des IDs Microstore (Product.microstoreProductId + ProductColor.microstoreVariantId)
 *
 * Pour chaque produit BJ déjà poussé sur Microstore (microstoreLastPushedAt != null)
 * mais dont on ne connaît pas encore l'ID côté marketplace :
 *   1. Appelle H5 /api/companies/goods/itemRef?itemRef=<ref>
 *   2. Récupère goodsId (= Microstore product ID) + skus[]
 *   3. Match chaque SKU Microstore par colorName ↔ Color.name (case-insensitive)
 *   4. Remplit Product.microstoreProductId + ProductColor.microstoreVariantId
 *
 * Requiert :
 *   - microstore_session_key configuré (Paramètres → Microstore)
 *   - microstore_picture_station_key configuré (Paramètres → Station de Transfert)
 *
 * Mode par défaut : dry-run (affiche ce qui serait fait sans écrire).
 * Ajouter --apply pour écrire réellement en BDD.
 *
 * Usage sur VPS :
 *   npx tsx scripts/backfill-microstore-goods-ids.ts            # dry-run
 *   npx tsx scripts/backfill-microstore-goods-ids.ts --apply    # écrit en BDD
 *   npx tsx scripts/backfill-microstore-goods-ids.ts --limit 5  # limite le batch
 */

import { PrismaClient } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import {
  getStoredPictureStation,
  getMicrostoreGoodsByItemRef,
} from "@/lib/microstore-picture-station";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const limitArgIdx = process.argv.indexOf("--limit");
const LIMIT = limitArgIdx >= 0 ? Number(process.argv[limitArgIdx + 1]) : undefined;
const TENANT_SLUG = process.env.TENANT_SLUG || "beliandjolie";

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

interface Stats {
  productsScanned: number;
  productsFound: number;
  productsMissing: number;
  variantsMatched: number;
  variantsOrphanBj: number;
  variantsOrphanMicrostore: number;
  updatedProducts: number;
  updatedVariants: number;
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  console.log(`[backfill] Tenant: ${tenant.slug}`);
  console.log(`[backfill] Mode: ${APPLY ? "🔧 APPLY (écrit en BDD)" : "🔍 DRY-RUN (lecture seule)"}`);
  if (LIMIT) console.log(`[backfill] Limite: ${LIMIT} produits max`);

  await tenantALS.run(tenant.id, async () => {
    // Vérifie que le pictureStationKey est configuré
    const station = await getStoredPictureStation();
    if (!station) {
      throw new Error(
        "microstore_picture_station_key non configuré. Va dans Paramètres → Microstore → Station de Transfert.",
      );
    }
    console.log(`[backfill] pictureStationKey OK (expire: ${station.expiresAt || "?"})`);

    // Liste les produits candidats
    const candidates = await prisma.product.findMany({
      where: {
        microstoreLastPushedAt: { not: null },
        microstoreProductId: null,
      },
      select: {
        id: true,
        reference: true,
        productColors: {
          where: { saleType: "UNIT", disabled: false },
          select: {
            id: true,
            colorId: true,
            microstoreVariantId: true,
            color: { select: { name: true } },
          },
        },
      },
      take: LIMIT,
    });

    console.log(`[backfill] ${candidates.length} produit(s) à backfiller\n`);

    const stats: Stats = {
      productsScanned: 0,
      productsFound: 0,
      productsMissing: 0,
      variantsMatched: 0,
      variantsOrphanBj: 0,
      variantsOrphanMicrostore: 0,
      updatedProducts: 0,
      updatedVariants: 0,
    };

    for (const bj of candidates) {
      stats.productsScanned++;
      let msGoods;
      try {
        msGoods = await getMicrostoreGoodsByItemRef(station.key, bj.reference);
      } catch (err) {
        console.log(`[${bj.reference}] ❌ Erreur fetch: ${(err as Error).message}`);
        continue;
      }

      if (!msGoods) {
        console.log(`[${bj.reference}] ⚠ Introuvable côté Microstore (produit peut-être supprimé manuellement)`);
        stats.productsMissing++;
        continue;
      }
      stats.productsFound++;

      // Match SKUs par colorName normalisé
      const msSkusByName = new Map<string, { skuId: number; colorId: number; colorName: string }>();
      for (const s of msGoods.skus || []) {
        msSkusByName.set(normalize(s.colorName), s);
      }
      const matchedVariantIds = new Set<number>();

      const perColorUpdates: Array<{ pcId: string; msSkuId: number; colorName: string }> = [];
      for (const pc of bj.productColors) {
        if (!pc.color?.name) continue;
        const key = normalize(pc.color.name);
        const msSku = msSkusByName.get(key);
        if (!msSku) {
          stats.variantsOrphanBj++;
          console.log(`[${bj.reference}]   • BJ variante "${pc.color.name}" → aucun SKU Microstore correspondant`);
          continue;
        }
        matchedVariantIds.add(msSku.skuId);
        if (pc.microstoreVariantId === msSku.skuId) continue; // déjà à jour
        perColorUpdates.push({ pcId: pc.id, msSkuId: msSku.skuId, colorName: pc.color.name });
        stats.variantsMatched++;
      }

      // SKUs Microstore orphelins (existent chez Microstore mais pas côté BJ)
      for (const s of msGoods.skus || []) {
        if (!matchedVariantIds.has(s.skuId)) {
          stats.variantsOrphanMicrostore++;
          console.log(`[${bj.reference}]   • MS variante "${s.colorName}" (skuId=${s.skuId}) → orpheline BJ`);
        }
      }

      console.log(
        `[${bj.reference}] ✓ goodsId=${msGoods.goodsId} — ${perColorUpdates.length} variante(s) à lier`,
      );

      if (APPLY) {
        // Update Product.microstoreProductId
        await prisma.product.update({
          where: { id: bj.id },
          data: { microstoreProductId: msGoods.goodsId },
        });
        stats.updatedProducts++;

        // Update chaque ProductColor.microstoreVariantId
        for (const upd of perColorUpdates) {
          await prisma.productColor.update({
            where: { id: upd.pcId },
            data: { microstoreVariantId: upd.msSkuId },
          });
          stats.updatedVariants++;
        }
      }
    }

    // Récap
    console.log(`\n════════════════════════════════════════`);
    console.log(`Produits scannés     : ${stats.productsScanned}`);
    console.log(`  ✓ trouvés Microstore: ${stats.productsFound}`);
    console.log(`  ⚠ introuvables      : ${stats.productsMissing}`);
    console.log(`Variantes matchées   : ${stats.variantsMatched}`);
    console.log(`  ⚠ orphelines BJ    : ${stats.variantsOrphanBj}`);
    console.log(`  ⚠ orphelines Micro.: ${stats.variantsOrphanMicrostore}`);
    if (APPLY) {
      console.log(`Écrits en BDD:`);
      console.log(`  Produits           : ${stats.updatedProducts}`);
      console.log(`  Variantes          : ${stats.updatedVariants}`);
    } else {
      console.log(`\n💡 Rien n'a été écrit — relance avec --apply pour appliquer`);
    }
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
