import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pfsTotalProducts } from "@/lib/pfs-api";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

// ─────────────────────────────────────────────
// GET — Get PFS product count + BJ synced count
// ─────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const [pfsCount, bjCount] = await Promise.all([
      pfsTotalProducts(),
      prisma.product.count({ where: { pfsProductId: { not: null } } }),
    ]);

    return NextResponse.json(
      { pfsCount, bjCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("[PFS Count] Error fetching product count", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "Erreur lors de la récupération du nombre de produits" },
      { status: 500 },
    );
  }
}
