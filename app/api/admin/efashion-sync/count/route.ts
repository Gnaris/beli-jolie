import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { efashionTotalProducts } from "@/lib/efashion-api";
import { ensureEfashionAuth } from "@/lib/efashion-auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// GET — Get eFashion product count + BJ synced count
// ─────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    await ensureEfashionAuth();

    const [efashionCount, bjCount] = await Promise.all([
      efashionTotalProducts(),
      prisma.product.count({ where: { efashionProductId: { not: null } } }),
    ]);

    return NextResponse.json(
      { efashionCount, bjCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("[eFashion Count] Error fetching product count", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Erreur lors de la récupération du nombre de produits" },
      { status: 500 },
    );
  }
}
