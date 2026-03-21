/**
 * PFS Sync Analyze Endpoint
 *
 * Dry-run analysis of PFS products to detect missing categories, colors,
 * and compositions before the actual sync. Does NOT create or modify anything.
 *
 * POST /api/admin/pfs-sync/analyze
 * Body: { limit?: number }  (10 for test, 0 or omitted for full scan)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  pfsListProducts,
  pfsCheckReference,
  type PfsProduct,
  type PfsCheckReferenceResponse,
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

function stripVersionSuffix(ref: string): string {
  return ref.replace(/VS\d+$/i, "");
}

/** Map PFS category reference to BJ category name. */
function parsePfsCategoryRef(ref: string): string {
  const parts = ref.split("/");
  const last = parts[parts.length - 1];

  const categoryMap: Record<string, string> = {
    EARRINGS: "Boucles d'oreilles",
    RINGS: "Bagues",
    NECKLACES: "Colliers",
    BRACELETS: "Bracelets",
    PENDANTS: "Pendentifs",
    PIERCINGS: "Piercings",
    SETS: "Parures de bijoux",
    KEYRINGS: "Porte-cles",
    DISPLAYSETS: "Lots avec presentoir",
    ANKLETS: "Bracelets de cheville",
    BROOCHES: "Broches",
    HAIRACCESSORIES: "Accessoires cheveux",
  };

  return categoryMap[last] ?? last;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MissingCategory {
  pfsName: string;
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
// POST handler
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  try {
    // Parse optional limit
    let limit = 0;
    try {
      const body = await req.json();
      limit = typeof body.limit === "number" ? body.limit : 0;
    } catch {
      // No body or invalid JSON — unlimited
    }

    // ── 1. Load existing DB entities ──
    const dbCategories = await prisma.category.findMany({ select: { id: true, name: true, slug: true } });
    const dbColors = await prisma.color.findMany({ select: { id: true, name: true } });
    const dbCompositions = await prisma.composition.findMany({ select: { id: true, name: true } });
    const pfsMappings = await prisma.pfsMapping.findMany({ select: { type: true, pfsName: true, bjName: true } });

    // Build lookup sets
    const categorySlugs = new Set<string>(dbCategories.map((c) => slugify(c.name)));
    const categoryNames = new Set<string>(dbCategories.map((c) => c.name.toLowerCase()));

    const colorNormalized = new Set<string>(dbColors.map((c) => normalizeColorName(c.name)));

    const compositionNormalized = new Set<string>(dbCompositions.map((c) => normalizeColorName(c.name)));

    // PfsMapping lookup: "type::normalizedPfsName" → bjName
    const mappingSet = new Set<string>(
      pfsMappings.map((m) => `${m.type}::${m.pfsName.toLowerCase()}`),
    );

    // ── 2. Paginate through PFS products ──
    const missingCategories = new Map<string, MissingCategory>();
    const missingColors = new Map<string, MissingColor>(); // keyed by normalized name
    const missingCompositions = new Map<string, MissingComposition>();
    let totalScanned = 0;
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      if (limit > 0 && totalScanned >= limit) break;

      const response = await pfsListProducts(page, 100);

      if (!response.data || response.data.length === 0) {
        hasMore = false;
        break;
      }

      for (const product of response.data) {
        if (limit > 0 && totalScanned >= limit) {
          hasMore = false;
          break;
        }

        // ── Analyze colors from variants ──
        analyzeColors(product, missingColors, colorNormalized, mappingSet);

        // ── Fetch composition data via checkReference ──
        let refDetails: PfsCheckReferenceResponse | null = null;
        try {
          const cleanRef = stripVersionSuffix(product.reference.trim().toUpperCase());
          refDetails = await pfsCheckReference(cleanRef);
        } catch {
          // Try with original reference
          try {
            refDetails = await pfsCheckReference(product.reference);
          } catch {
            // Non-critical — skip composition analysis for this product
          }
        }

        // ── Analyze category (with refDetails if available for better name) ──
        analyzeCategory(product, refDetails, missingCategories, categorySlugs, categoryNames, mappingSet);

        // ── Analyze compositions ──
        if (refDetails?.product?.material_composition) {
          analyzeCompositions(
            refDetails.product.material_composition,
            missingCompositions,
            compositionNormalized,
            mappingSet,
          );
        }

        totalScanned++;

        // Rate limiting delay between API calls
        await new Promise((r) => setTimeout(r, 200));
      }

      page++;

      // Additional delay between pages
      await new Promise((r) => setTimeout(r, 300));
    }

    // ── 3. Build response ──
    const result = {
      totalScanned,
      missingEntities: {
        categories: Array.from(missingCategories.values()).sort((a, b) => b.usedBy - a.usedBy),
        colors: Array.from(missingColors.values()).sort((a, b) => b.usedBy - a.usedBy),
        compositions: Array.from(missingCompositions.values()).sort((a, b) => b.usedBy - a.usedBy),
      },
      existingMappings: pfsMappings.length,
    };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// Analysis helpers
// ─────────────────────────────────────────────

function analyzeCategory(
  product: PfsProduct,
  refDetails: PfsCheckReferenceResponse | null,
  missing: Map<string, MissingCategory>,
  categorySlugs: Set<string>,
  categoryNames: Set<string>,
  mappingSet: Set<string>,
) {
  const categoryFr = product.category?.labels?.fr;
  if (!categoryFr) return;

  // Determine the suggested BJ name
  let suggestedName = categoryFr;
  if (refDetails?.product?.category?.reference) {
    suggestedName = parsePfsCategoryRef(refDetails.product.category.reference);
  }

  const slug = slugify(suggestedName);
  const nameLower = suggestedName.toLowerCase();

  // Check if already exists in DB
  if (categorySlugs.has(slug) || categoryNames.has(nameLower)) return;

  // Check if already mapped via PfsMapping
  const mappingKey = `category::${categoryFr.toLowerCase()}`;
  if (mappingSet.has(mappingKey)) return;

  // Also check mapping with suggested name
  const mappingKey2 = `category::${suggestedName.toLowerCase()}`;
  if (mappingSet.has(mappingKey2)) return;

  // Key by lowercase categoryFr to avoid duplicates
  const key = categoryFr.toLowerCase();
  const existing = missing.get(key);
  if (existing) {
    existing.usedBy++;
    // Update suggested name if refDetails provided a better one
    if (suggestedName !== categoryFr) {
      existing.suggestedName = suggestedName;
    }
  } else {
    missing.set(key, {
      pfsName: categoryFr,
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

  // Collect unique colors from this product's variants
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

    // Skip if already processed in this product
    if (seenColors.has(normalized)) continue;
    seenColors.add(normalized);

    // Check if exists in DB
    if (colorNormalized.has(normalized)) continue;

    // Check if mapped via PfsMapping
    const mappingKey = `color::${frLabel.toLowerCase()}`;
    if (mappingSet.has(mappingKey)) continue;

    // Also check normalized version
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

function analyzeCompositions(
  materials: {
    id: string;
    reference: string;
    percentage: number;
    labels: Record<string, string>;
  }[],
  missing: Map<string, MissingComposition>,
  compositionNormalized: Set<string>,
  mappingSet: Set<string>,
) {
  for (const mat of materials) {
    const frName = mat.labels?.fr || mat.reference;
    const normalized = normalizeColorName(frName);

    // Check if exists in DB
    if (compositionNormalized.has(normalized)) continue;

    // Check if mapped via PfsMapping
    const mappingKey = `composition::${frName.toLowerCase()}`;
    if (mappingSet.has(mappingKey)) continue;

    const mappingKey2 = `composition::${normalized}`;
    if (mappingSet.has(mappingKey2)) continue;

    const existingEntry = missing.get(normalized);
    if (existingEntry) {
      existingEntry.usedBy++;
    } else {
      missing.set(normalized, {
        pfsName: frName,
        suggestedName: frName,
        usedBy: 1,
        pfsLabels: mat.labels || {},
      });
    }
  }
}
