/**
 * PFS Sync Analyze Endpoint (SSE streaming)
 *
 * Dry-run analysis of PFS products to detect missing categories, colors,
 * and compositions before the actual sync. Does NOT create or modify anything.
 *
 * Streams progress via Server-Sent Events so the frontend can show real-time updates.
 *
 * POST /api/admin/pfs-sync/analyze
 * Body: { limit?: number }  (10 for test, 0 or omitted for full scan)
 *
 * SSE events:
 *   - { type: "progress", page, lastPage, totalScanned, missingColors, missingCategories }
 *   - { type: "done", ...fullResult }
 *   - { type: "error", message }
 */

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  pfsListProducts,
  type PfsProduct,
} from "@/lib/pfs-api";
import { normalizeColorName } from "@/lib/import-processor";

// ─────────────────────────────────────────────
// Helpers (duplicated from pfs-sync.ts to avoid coupling)
// ─────────────────────────────────────────────

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MissingCategory {
  pfsName: string;
  pfsCategoryId: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingColor {
  pfsName: string;
  pfsReference: string;
  suggestedName: string;
  hex: string | null;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

interface MissingComposition {
  pfsName: string;
  suggestedName: string;
  usedBy: number;
  pfsLabels: Record<string, string>;
}

// ─────────────────────────────────────────────
// POST handler — SSE streaming
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return new Response(JSON.stringify({ error: "Non autorise" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse optional limit
  let limit = 0;
  try {
    const body = await req.json();
    limit = typeof body.limit === "number" ? body.limit : 0;
  } catch {
    // No body or invalid JSON — unlimited
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "progress", message: "Chargement des données existantes..." });

        // ── 1. Load existing DB entities ──
        const [dbCategories, dbColors, pfsMappings] = await Promise.all([
          prisma.category.findMany({ select: { id: true, name: true, slug: true } }),
          prisma.color.findMany({ select: { id: true, name: true } }),
          prisma.pfsMapping.findMany({ select: { type: true, pfsName: true, bjName: true } }),
        ]);

        const categorySlugs = new Set<string>(dbCategories.map((c) => slugify(c.name)));
        const categoryNames = new Set<string>(dbCategories.map((c) => c.name.toLowerCase()));
        const colorNormalized = new Set<string>(dbColors.map((c) => normalizeColorName(c.name)));

        // Only trust mappings whose target entity still exists in the DB
        // This prevents orphaned mappings (entity deleted after a previous sync)
        // from masking missing entities
        const mappingSet = new Set<string>();
        for (const m of pfsMappings) {
          const key = `${m.type}::${m.pfsName.toLowerCase()}`;
          if (m.type === "category") {
            // Check if the mapped category still exists
            const bjSlug = slugify(m.bjName);
            const bjNameLower = m.bjName.toLowerCase();
            if (categorySlugs.has(bjSlug) || categoryNames.has(bjNameLower)) {
              mappingSet.add(key);
            }
          } else if (m.type === "color") {
            // Check if the mapped color still exists
            const bjNormalized = normalizeColorName(m.bjName);
            if (colorNormalized.has(bjNormalized)) {
              mappingSet.add(key);
            }
          } else {
            // composition and other types: trust the mapping
            mappingSet.add(key);
          }
        }

        send({
          type: "progress",
          message: `${dbCategories.length} catégories, ${dbColors.length} couleurs, ${pfsMappings.length} mappings chargés`,
        });

        // ── 2. Paginate through PFS products ──
        const missingCategories = new Map<string, MissingCategory>();
        const missingColors = new Map<string, MissingColor>();
        let totalScanned = 0;
        let page = 1;
        let lastPage = Infinity;
        const PAGE_CONCURRENCY = 10;
        let errorPages = 0;

        // First request to discover lastPage
        try {
          const firstResponse = await pfsListProducts(1, 100);
          if (firstResponse.meta?.last_page) {
            lastPage = firstResponse.meta.last_page;
          }
          if (firstResponse.data && firstResponse.data.length > 0) {
            let firstPageProducts = firstResponse.data;
            // Apply limit on first page too
            if (limit > 0) {
              firstPageProducts = firstPageProducts.slice(0, limit);
            }
            for (const product of firstPageProducts) {
              analyzeColors(product, missingColors, colorNormalized, mappingSet);
              analyzeCategory(product, missingCategories, categorySlugs, categoryNames, mappingSet);
              totalScanned++;
            }
          }
          send({
            type: "progress",
            page: 1,
            lastPage: lastPage < Infinity ? lastPage : null,
            totalScanned,
            missingColors: missingColors.size,
            missingCategories: missingCategories.size,
            message: `Page 1/${lastPage < Infinity ? lastPage : "?"} — ${totalScanned} produits analysés`,
          });
          page = 2;
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : "Erreur page 1" });
          controller.close();
          return;
        }

        // Process remaining pages in parallel batches
        while (page <= lastPage) {
          if (limit > 0 && totalScanned >= limit) break;

          // Build batch of page numbers
          const batchEnd = Math.min(page + PAGE_CONCURRENCY - 1, lastPage);
          const pageNumbers: number[] = [];
          for (let p = page; p <= batchEnd; p++) {
            pageNumbers.push(p);
          }

          send({
            type: "progress",
            page,
            lastPage,
            totalScanned,
            missingColors: missingColors.size,
            missingCategories: missingCategories.size,
            message: `Pages ${page}-${batchEnd}/${lastPage} en parallèle — ${totalScanned} produits analysés...`,
          });

          // Fetch all pages in parallel
          const results = await Promise.allSettled(
            pageNumbers.map((p) => pfsListProducts(p, 100)),
          );

          let batchEmpty = true;
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === "rejected") {
              errorPages++;
              send({
                type: "progress",
                page: pageNumbers[i],
                lastPage,
                totalScanned,
                missingColors: missingColors.size,
                missingCategories: missingCategories.size,
                message: `⚠️ Page ${pageNumbers[i]} échouée — ${result.reason instanceof Error ? result.reason.message : "erreur"} (on continue)`,
              });
              continue;
            }

            const response = result.value;
            if (!response.data || response.data.length === 0) continue;

            batchEmpty = false;
            let pageProducts = response.data;
            if (limit > 0) {
              const remaining = limit - totalScanned;
              if (remaining <= 0) break;
              pageProducts = pageProducts.slice(0, remaining);
            }

            for (const product of pageProducts) {
              analyzeColors(product, missingColors, colorNormalized, mappingSet);
              analyzeCategory(product, missingCategories, categorySlugs, categoryNames, mappingSet);
              totalScanned++;
            }
          }

          // If all pages in batch were empty, stop
          if (batchEmpty && results.every((r) => r.status === "fulfilled")) break;

          page = batchEnd + 1;
          await new Promise((r) => setTimeout(r, 200));
        }

        if (errorPages > 0) {
          send({
            type: "progress",
            totalScanned,
            missingColors: missingColors.size,
            missingCategories: missingCategories.size,
            message: `⚠️ ${errorPages} page(s) en erreur — résultats partiels`,
          });
        }

        // ── 3. Send final result ──
        send({
          type: "done",
          totalScanned,
          pagesScanned: page - 1,
          missingEntities: {
            categories: Array.from(missingCategories.values()).sort((a, b) => b.usedBy - a.usedBy),
            colors: Array.from(missingColors.values()).sort((a, b) => b.usedBy - a.usedBy),
            compositions: [] as MissingComposition[],
          },
          existingMappings: pfsMappings.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur interne";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─────────────────────────────────────────────
// Analysis helpers
// ─────────────────────────────────────────────

function analyzeCategory(
  product: PfsProduct,
  missing: Map<string, MissingCategory>,
  categorySlugs: Set<string>,
  categoryNames: Set<string>,
  mappingSet: Set<string>,
) {
  const categoryFr = product.category?.labels?.fr;
  if (!categoryFr) return;

  const suggestedName = categoryFr;
  const slug = slugify(suggestedName);
  const nameLower = suggestedName.toLowerCase();

  if (categorySlugs.has(slug) || categoryNames.has(nameLower)) return;

  const mappingKey = `category::${categoryFr.toLowerCase()}`;
  if (mappingSet.has(mappingKey)) return;

  const mappingKey2 = `category::${suggestedName.toLowerCase()}`;
  if (mappingSet.has(mappingKey2)) return;

  const key = categoryFr.toLowerCase();
  const existing = missing.get(key);
  if (existing) {
    existing.usedBy++;
  } else {
    missing.set(key, {
      pfsName: categoryFr,
      pfsCategoryId: product.category.id,
      suggestedName,
      usedBy: 1,
      pfsLabels: product.category.labels || {},
    });
  }
}

function analyzeColors(
  product: PfsProduct,
  missing: Map<string, MissingColor>,
  colorNormalized: Set<string>,
  mappingSet: Set<string>,
) {
  if (!product.variants) return;

  const seenColors = new Set<string>();

  for (const v of product.variants) {
    let colorInfo: { reference: string; value: string; labels: Record<string, string> } | null = null;

    if (v.type === "ITEM" && v.item?.color) {
      colorInfo = v.item.color;
    } else if (v.type === "PACK" && v.packs && v.packs.length > 0) {
      colorInfo = v.packs[0].color;
    }

    if (!colorInfo) continue;

    const frLabel = colorInfo.labels?.fr || colorInfo.reference;
    const normalized = normalizeColorName(frLabel);

    if (seenColors.has(normalized)) continue;
    seenColors.add(normalized);

    if (colorNormalized.has(normalized)) continue;

    const mappingKey = `color::${frLabel.toLowerCase()}`;
    if (mappingSet.has(mappingKey)) continue;

    const mappingKey2 = `color::${normalized}`;
    if (mappingSet.has(mappingKey2)) continue;

    const existingEntry = missing.get(normalized);
    if (existingEntry) {
      existingEntry.usedBy++;
    } else {
      missing.set(normalized, {
        pfsName: frLabel,
        pfsReference: colorInfo.reference,
        suggestedName: frLabel,
        hex: colorInfo.value || null,
        usedBy: 1,
        pfsLabels: colorInfo.labels || {},
      });
    }
  }
}

// Note: compositions are detected during sync (via checkReference API).
// They are not analyzed here to avoid 9000+ individual API calls.
