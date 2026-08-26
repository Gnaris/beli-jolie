/**
 * Backfill / liaison de masse des IDs Microstore
 * (Product.microstoreProductId + ProductColor.microstoreVariantId).
 *
 * Pour chaque produit BJ sans microstoreProductId (poussé ou pas depuis BJ) :
 *   1. Appelle H5 /api/companies/goods/itemRef?itemRef=<ref>
 *   2. Refuse toute réponse dont l'itemRef ne matche pas la réf BJ
 *      **lettre par lettre** (aucune tolérance : produit non lié).
 *   3. Match chaque SKU Microstore par colorName ↔ Color.name (normalisé
 *      lowercase + sans accents pour absorber les petites variations de saisie).
 *   4. Écrit Product.microstoreProductId + ProductColor.microstoreVariantId.
 *   5. (Optionnel, avec --sync) Déclenche une synchro (microstorePushProduct)
 *      pour aligner titre, prix, stock, description, catégorie… — même
 *      comportement que le bouton "Publier sur Microstore" du back-office.
 *      Pré-check strict des mappings BJ↔Microstore (catégorie, couleurs) :
 *      un mapping manquant → produit lié mais synchro refusée + badge
 *      "Synchro nécessaire" sur la fiche BJ.
 *
 * Requiert :
 *   - microstore_session_key configuré (QR compagnon MC Gérant)
 *   - microstore_picture_station_key configuré (Station de Transfert)
 *
 * Mode par défaut : dry-run (aucune écriture, aucune synchro).
 * Ajouter --apply pour écrire les IDs. Ajouter --sync pour aussi déclencher
 * la synchro Microstore juste après (uniquement si les mappings d'attributs
 * BJ↔Microstore sont complets).
 *
 * Usage :
 *   npx tsx scripts/backfill-microstore-goods-ids.ts                # dry-run
 *   npx tsx scripts/backfill-microstore-goods-ids.ts --apply        # lie seulement
 *   npx tsx scripts/backfill-microstore-goods-ids.ts --apply --sync # lie + synchro
 *   npx tsx scripts/backfill-microstore-goods-ids.ts --limit 5      # limite le batch
 */

import { PrismaClient } from "@prisma/client";
import { tenantALS } from "@/lib/tenant-als";
import {
  getStoredPictureStation,
  getMicrostoreGoodsByItemRef,
} from "@/lib/microstore-picture-station";
import { microstorePushProduct } from "@/lib/microstore-products";
import {
  loadExportContext,
  loadExportProducts,
} from "@/lib/marketplace-excel/load-products";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const RUN_SYNC = process.argv.includes("--sync");
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
  syncOk: number;
  syncFailed: number;
}

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" introuvable`);

  console.log(`[backfill] Tenant: ${tenant.slug}`);
  console.log(`[backfill] Mode: ${APPLY ? "🔧 APPLY (écrit en BDD)" : "🔍 DRY-RUN (lecture seule)"}`);
  console.log(`[backfill] Synchro Microstore: ${RUN_SYNC ? "OUI (--sync)" : "NON (liaison seule)"}`);
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

    // Liste les produits candidats : tout produit BJ pas encore lié à Microstore
    // (peu importe qu'il ait déjà été poussé ou pas depuis BJ).
    const candidates = await prisma.product.findMany({
      where: {
        microstoreProductId: null,
        status: { in: ["ONLINE", "OFFLINE", "SYNCING"] },
      },
      select: {
        id: true,
        reference: true,
        colors: {
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
      syncOk: 0,
      syncFailed: 0,
    };

    // ExportContext chargé une seule fois si on doit synchroniser
    const exportCtx = APPLY && RUN_SYNC ? await loadExportContext() : null;

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
        console.log(`[${bj.reference}] ⚠ Introuvable côté Microstore — non lié`);
        stats.productsMissing++;
        continue;
      }
      if (msGoods.itemRef !== bj.reference) {
        console.log(
          `[${bj.reference}] ⚠ Microstore a renvoyé "${msGoods.itemRef}" (≠ lettre par lettre) — non lié`,
        );
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
      for (const pc of bj.colors) {
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
        // Update Product.microstoreProductId + pose le flag "en ligne" pour
        // que le badge Microstore passe au vert. `microstoreSyncRequired=true`
        // rappelle qu'il faudra un refresh pour aligner le contenu.
        await prisma.product.update({
          where: { id: bj.id },
          data: {
            microstoreProductId: msGoods.goodsId,
            microstoreLastPushedAt: new Date(),
            microstoreSyncRequired: true,
          },
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

        // Synchro optionnelle (--sync) : même comportement que le bouton
        // "Publier sur Microstore" du back-office. Pré-check strict des
        // mappings BJ↔Microstore ; refusée si un mapping manque.
        if (RUN_SYNC) {
          try {
            const [exportProduct] = await loadExportProducts([bj.id]);
            if (!exportProduct) {
              console.log(`[${bj.reference}]   ⚠ Synchro : produit introuvable en export`);
              stats.syncFailed++;
            } else {
              const result = await microstorePushProduct(exportProduct, exportCtx!);
              if (result.success) {
                await prisma.product.update({
                  where: { id: bj.id },
                  data: {
                    microstoreLastPushedAt: new Date(),
                    microstoreSyncRequired: false,
                  },
                });
                console.log(`[${bj.reference}]   ✓ Synchro OK`);
                stats.syncOk++;
              } else {
                console.log(
                  `[${bj.reference}]   ❌ Synchro refusée : ${result.error || `err=${result.errCode ?? "?"}`}`,
                );
                stats.syncFailed++;
              }
            }
          } catch (err) {
            console.log(`[${bj.reference}]   ❌ Synchro erreur : ${(err as Error).message}`);
            stats.syncFailed++;
          }
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
      if (RUN_SYNC) {
        console.log(`Synchro Microstore   :`);
        console.log(`  ✓ OK               : ${stats.syncOk}`);
        console.log(`  ❌ Refusée/erreur  : ${stats.syncFailed}`);
      } else {
        console.log(`Synchro Microstore   : non lancée (relance avec --apply --sync après avoir mappé les attributs)`);
      }
    } else {
      console.log(`\n💡 Rien n'a été écrit — relance avec --apply pour lier`);
    }
  });

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
