import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCachedPfsEnabled } from "@/lib/cached-data";
import { pfsGetColors, pfsGetCategories, pfsGetCompositions, pfsGetCountries, pfsGetCollections, pfsGetFamilies, pfsGetGenders, pfsGetSizes } from "@/lib/pfs-api-write";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/pfs-sync/attributes
 * Fetch available PFS attributes (colors, categories, compositions, families, genders) for mapping UI.
 * Admin only. Resilient: individual attribute failures return empty arrays instead of failing the whole request.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const hasPfs = await getCachedPfsEnabled();
  if (!hasPfs) {
    return NextResponse.json({
      colors: [], categories: [], compositions: [], countries: [],
      collections: [], families: [], genders: [], sizes: [],
      pfsDisabled: true,
    });
  }

  const errors: string[] = [];

  async function safe<T>(fn: () => Promise<T[]>, label: string): Promise<T[]> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${label}: ${msg}`);
      logger.error(`[PFS attributes] ${label} failed`, { error: msg });
      return [];
    }
  }

  const [colors, categories, compositions, countries, collections, families, genders, sizes] = await Promise.all([
    safe(pfsGetColors, "colors"),
    safe(pfsGetCategories, "categories"),
    safe(pfsGetCompositions, "compositions"),
    safe(pfsGetCountries, "countries"),
    safe(pfsGetCollections, "collections"),
    safe(pfsGetFamilies, "families"),
    safe(pfsGetGenders, "genders"),
    safe(pfsGetSizes, "sizes"),
  ]);

  // If ALL attributes failed, return 500 with details
  const totalItems = colors.length + categories.length + compositions.length + countries.length + collections.length + families.length + genders.length + sizes.length;
  if (totalItems === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join(" | ") }, { status: 500 });
  }

  return NextResponse.json({
    colors, categories, compositions, countries, collections, families, genders, sizes,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
}
