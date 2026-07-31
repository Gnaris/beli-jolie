/**
 * POST /api/admin/marketplace-queue/dismiss
 *
 * Retire une ou plusieurs lignes du widget flottant marketplaces en marquant
 * les jobs correspondants comme CANCELLED. Ne touche PAS aux jobs actuellement
 * en vol (IN_PROGRESS / AWAITING_CALLBACK) — on ne veut pas couper un appel
 * marketplace au milieu.
 *
 * Body : `{ ids: string[] }` (identifiants des MarketplaceRefreshJob).
 * Réponse : `{ dismissed: number }`.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  let ids: string[] = [];
  try {
    const raw = (await request.json()) as { ids?: unknown };
    if (Array.isArray(raw.ids)) {
      ids = raw.ids.filter((v): v is string => typeof v === "string" && v.length > 0);
    }
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ error: "Aucun identifiant fourni." }, { status: 400 });
  }

  const res = await prisma.marketplaceRefreshJob.updateMany({
    where: {
      id: { in: ids },
      status: { in: ["QUEUED", "SUCCEEDED", "FAILED"] },
    },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({ dismissed: res.count });
}
