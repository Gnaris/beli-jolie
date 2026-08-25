/**
 * POST /api/admin/marketplace-queue/stop
 *
 * Annule les jobs encore QUEUED (en attente). N'interrompt PAS les jobs
 * IN_PROGRESS / AWAITING_CALLBACK pour éviter de casser un appel marketplace
 * en cours.
 *
 * Corps optionnel : `{ mode?: "publish" | "refresh" | "resync" }` — quand
 * fourni, ne cible que les jobs de ce mode (permet à l'admin d'arrêter par ex.
 * uniquement les rafraîchissements sans toucher aux modifications planifiées).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MarketplaceJobMode, Prisma } from "@prisma/client";

const MODE_MAP: Record<string, MarketplaceJobMode> = {
  publish: "PUBLISH",
  refresh: "REFRESH",
  resync: "RESYNC",
  disable: "DISABLE",
  enable: "ENABLE",
  delete: "DELETE",
};

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  let mode: MarketplaceJobMode | undefined;
  try {
    const raw = (await request.json().catch(() => null)) as { mode?: string } | null;
    if (raw && typeof raw.mode === "string" && raw.mode in MODE_MAP) {
      mode = MODE_MAP[raw.mode];
    }
  } catch {
    // corps invalide → on tombe sur stop global
  }

  const where: Prisma.MarketplaceRefreshJobWhereInput = { status: "QUEUED" };
  if (mode) where.mode = mode;

  const res = await prisma.marketplaceRefreshJob.updateMany({
    where,
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({ cancelled: res.count });
}
