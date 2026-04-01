/**
 * eFashion Analyze Processor (Background Job)
 *
 * Scans eFashion products to detect missing entities:
 * categories, colors, compositions.
 * Only for products not already in DB (matched by efashionProductId).
 */

import { prisma } from "@/lib/prisma";
import {
  efashionListProducts,
  efashionGetProductCompositions,
  type EfashionProductListItem,
} from "@/lib/efashion-api";
import { ensureEfashionAuth } from "@/lib/efashion-auth";
import { logger } from "@/lib/logger";

// Suppress unused import warning — EfashionProductListItem used for type safety below
type _EfashionProductListItem = EfashionProductListItem;

// Types for missing entities
interface MissingCategory {
  efashionId: number;
  efashionName: string;
  suggestedName: string;
  usedBy: number;
}

interface MissingColor {
  efashionId: number;
  efashionName: string;
  suggestedName: string;
  usedBy: number;
}

interface MissingComposition {
  efashionId: number;
  efashionName: string;
  suggestedName: string;
  usedBy: number;
}

// Constants
const ANALYZE_CONCURRENCY = 10; // parallel product detail fetches for compositions
const MAX_ANALYZE_LOGS = 500;
const PAGE_SIZE = 100;

// Main entry point
export async function runEfashionAnalyze(
  jobId: string,
  options?: { limit?: number }
): Promise<void> {
  const maxProducts = options?.limit ?? 0;
  const analyzeLogs: string[] = [];

  // Helper: add timestamped log
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    analyzeLogs.push(`[${time}] ${msg}`);
    if (analyzeLogs.length > MAX_ANALYZE_LOGS) analyzeLogs.shift();
  };

  // Helper: update job in DB
  const updateJob = async (data: Record<string, unknown>) => {
    await prisma.efashionPrepareJob.update({
      where: { id: jobId },
      data: { ...data, logs: { analyzeLogs } },
    });
  };

  // Helper: check if stopped by admin
  const checkStopped = async (): Promise<boolean> => {
    const current = await prisma.efashionPrepareJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return current?.status === "STOPPED";
  };

  try {
    await ensureEfashionAuth();
    addLog("Chargement des données existantes...");
    await updateJob({});

    // 1. Load existing DB entities
    const [
      dbCategories,
      dbColors,
      dbCompositions,
      efashionMappings,
      existingEfashionIds,
    ] = await Promise.all([
      prisma.category.findMany({
        select: { id: true, name: true, efashionCategoryId: true },
      }),
      prisma.color.findMany({
        select: { id: true, name: true, efashionColorId: true, hex: true, patternImage: true },
      }),
      prisma.composition.findMany({ select: { id: true, name: true } }),
      prisma.efashionMapping.findMany({
        select: {
          type: true,
          efashionName: true,
          efashionId: true,
          bjName: true,
        },
      }),
      prisma.product.findMany({
        where: { efashionProductId: { not: null } },
        select: { efashionProductId: true },
      }),
    ]);

    // Build lookup sets
    const categoryByEfashionId = new Set(
      dbCategories
        .filter((c) => c.efashionCategoryId)
        .map((c) => c.efashionCategoryId!)
    );
    const colorByEfashionId = new Set(
      dbColors
        .filter((c) => c.efashionColorId)
        .map((c) => c.efashionColorId!)
    );
    const compositionByName = new Set(
      dbCompositions.map((c) => c.name.toLowerCase())
    );
    const existingProductIds = new Set(
      existingEfashionIds.map((p) => p.efashionProductId!)
    );

    // Build mapping sets
    const mappingSet = new Set<string>();
    for (const m of efashionMappings) {
      mappingSet.add(`${m.type}::${m.efashionName.toLowerCase()}`);
      if (m.efashionId) mappingSet.add(`${m.type}::id::${m.efashionId}`);
    }

    addLog(
      `${dbCategories.length} catégories, ${dbColors.length} couleurs, ${dbCompositions.length} compositions chargées`
    );
    await updateJob({});

    // 2. Paginate eFashion products & collect missing entities
    const missingCategories = new Map<number, MissingCategory>();
    const missingColors = new Map<number, MissingColor>();
    const newProductIds: number[] = []; // for phase 2 composition check

    let totalScanned = 0;
    let totalNewProducts = 0;
    let totalExistingSkipped = 0;
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      if (maxProducts > 0 && totalNewProducts >= maxProducts) break;
      if (await checkStopped()) {
        addLog("Arrêt demandé par l'administrateur");
        break;
      }

      try {
        const { items, total } = await efashionListProducts(
          skip,
          PAGE_SIZE,
          "EN_VENTE"
        );

        if (items.length === 0) {
          hasMore = false;
          break;
        }

        for (const item of items) {
          totalScanned++;

          // Skip existing products
          if (existingProductIds.has(item.id_produit)) {
            totalExistingSkipped++;
            continue;
          }

          if (maxProducts > 0 && totalNewProducts >= maxProducts) break;
          totalNewProducts++;
          newProductIds.push(item.id_produit);

          // Check category
          if (item.id_categorie) {
            const catId = item.id_categorie;
            if (
              !categoryByEfashionId.has(catId) &&
              !mappingSet.has(`category::id::${catId}`)
            ) {
              if (missingCategories.has(catId)) {
                missingCategories.get(catId)!.usedBy++;
              } else {
                missingCategories.set(catId, {
                  efashionId: catId,
                  efashionName: item.categorie || `Catégorie ${catId}`,
                  suggestedName: item.categorie || `Catégorie ${catId}`,
                  usedBy: 1,
                });
              }
            }
          }

          // Check color
          if (item.id_couleur) {
            const colorId = item.id_couleur;
            if (
              !colorByEfashionId.has(colorId) &&
              !mappingSet.has(`color::id::${colorId}`)
            ) {
              if (missingColors.has(colorId)) {
                missingColors.get(colorId)!.usedBy++;
              } else {
                missingColors.set(colorId, {
                  efashionId: colorId,
                  efashionName: item.couleur || `Couleur ${colorId}`,
                  suggestedName: item.couleur || `Couleur ${colorId}`,
                  usedBy: 1,
                });
              }
            }
          }
        }

        addLog(
          `Skip ${skip} — ${totalScanned}/${total} analysés, ${totalNewProducts} nouveaux`
        );
        await updateJob({ totalProducts: totalNewProducts });

        skip += PAGE_SIZE;
        hasMore = skip < total;
        await new Promise((r) => setTimeout(r, 200)); // gentle rate limiting
      } catch (err) {
        addLog(
          `Erreur à skip=${skip}: ${err instanceof Error ? err.message : "Erreur"}`
        );
        // Try next batch
        skip += PAGE_SIZE;
      }
    }

    // Early exit if no new products
    if (totalNewProducts === 0) {
      addLog("Aucun nouveau produit à importer.");
      await prisma.efashionPrepareJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          totalProducts: 0,
          analyzeResult: {
            totalScanned,
            totalNewProducts: 0,
            totalExistingSkipped,
            missingEntities: { categories: [], colors: [], compositions: [] },
            existingMappings: efashionMappings.length,
            existingEntities: {
              categories: dbCategories.map((c) => ({ id: c.id, name: c.name })),
              colors: dbColors.map((c) => ({ id: c.id, name: c.name, hex: c.hex ?? null, patternImage: c.patternImage ?? null })),
              compositions: dbCompositions.map((c) => ({ id: c.id, name: c.name })),
            },
          },
          logs: { analyzeLogs },
        },
      });
      return;
    }

    // 3. Phase 2 — Check compositions for a sample of products
    addLog(
      `Vérification compositions pour ${Math.min(newProductIds.length, 50)} produit(s)...`
    );

    const missingCompositions = new Map<number, MissingComposition>();
    const sampleIds = newProductIds.slice(0, 50); // check first 50 products

    for (let i = 0; i < sampleIds.length; i += ANALYZE_CONCURRENCY) {
      if (await checkStopped()) break;

      const batch = sampleIds.slice(i, i + ANALYZE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((id) => efashionGetProductCompositions(id))
      );

      for (const res of results) {
        if (res.status !== "fulfilled") continue;
        for (const comp of res.value) {
          const compId = comp.id_composition;
          const compName = comp.libelle;

          if (compositionByName.has(compName.toLowerCase())) continue;
          if (mappingSet.has(`composition::${compName.toLowerCase()}`)) continue;
          if (mappingSet.has(`composition::id::${compId}`)) continue;

          if (missingCompositions.has(compId)) {
            missingCompositions.get(compId)!.usedBy++;
          } else {
            missingCompositions.set(compId, {
              efashionId: compId,
              efashionName: compName,
              suggestedName: compName,
              usedBy: 1,
            });
          }
        }
      }
    }

    // 4. Finalize
    const analyzeResult = {
      totalScanned,
      totalNewProducts,
      totalExistingSkipped,
      missingEntities: {
        categories: [...missingCategories.values()],
        colors: [...missingColors.values()],
        compositions: [...missingCompositions.values()],
      },
      existingMappings: efashionMappings.length,
      existingEntities: {
        categories: dbCategories.map((c) => ({ id: c.id, name: c.name })),
        colors: dbColors.map((c) => ({ id: c.id, name: c.name, hex: c.hex ?? null, patternImage: c.patternImage ?? null })),
        compositions: dbCompositions.map((c) => ({ id: c.id, name: c.name })),
      },
      limit: maxProducts > 0 ? maxProducts : undefined,
    };

    const hasMissing =
      missingCategories.size > 0 ||
      missingColors.size > 0 ||
      missingCompositions.size > 0;

    if (hasMissing) {
      addLog(
        `Entités manquantes: ${missingCategories.size} catégories, ${missingColors.size} couleurs, ${missingCompositions.size} compositions`
      );
      await prisma.efashionPrepareJob.update({
        where: { id: jobId },
        data: {
          status: "NEEDS_VALIDATION",
          totalProducts: totalNewProducts,
          analyzeResult,
          logs: { analyzeLogs },
        },
      });
    } else {
      addLog(
        `Toutes les entités sont mappées — ${totalNewProducts} produits prêts pour l'import`
      );
      await prisma.efashionPrepareJob.update({
        where: { id: jobId },
        data: {
          status: "RUNNING",
          totalProducts: totalNewProducts,
          analyzeResult,
          logs: { analyzeLogs },
        },
      });
    }
  } catch (err) {
    logger.error("[eFashion Analyze] Fatal error:", { error: err instanceof Error ? err.message : String(err) });
    await prisma.efashionPrepareJob
      .update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          errorMessage:
            err instanceof Error ? err.message : "Erreur fatale",
          logs: { analyzeLogs },
        },
      })
      .catch(() => {});
  }
}
