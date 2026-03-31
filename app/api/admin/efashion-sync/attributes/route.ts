import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureEfashionAuth } from "@/lib/efashion-auth";
import {
  efashionGetCategories,
  efashionGetDefaultColors,
  efashionGetPacks,
  efashionGetDeclinaisons,
} from "@/lib/efashion-api";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/efashion-sync/attributes
 * Fetch available eFashion attributes (categories, colors, packs, declinaisons) for mapping UI.
 * Admin only. Resilient: individual attribute failures return empty arrays.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    await ensureEfashionAuth();
  } catch (error) {
    logger.error("[eFashion Attributes] Auth failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Impossible de se connecter à eFashion" },
      { status: 500 },
    );
  }

  const errors: string[] = [];

  async function safe<T>(fn: () => Promise<T[]>, label: string): Promise<T[]> {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${label}: ${msg}`);
      logger.error(`[eFashion Attributes] ${label} failed`, { error: msg });
      return [];
    }
  }

  const [categories, colors, packs, declinaisons] = await Promise.all([
    safe(efashionGetCategories, "categories"),
    safe(efashionGetDefaultColors, "colors"),
    safe(efashionGetPacks, "packs"),
    safe(efashionGetDeclinaisons, "declinaisons"),
  ]);

  // If ALL attributes failed, return 500 with details
  const totalItems = categories.length + colors.length + packs.length + declinaisons.length;
  if (totalItems === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join(" | ") }, { status: 500 });
  }

  return NextResponse.json({
    categories,
    colors,
    packs,
    declinaisons,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
}
