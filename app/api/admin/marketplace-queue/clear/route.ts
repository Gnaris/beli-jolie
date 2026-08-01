/**
 * POST /api/admin/marketplace-queue/clear
 *
 * Marque les jobs ✓ terminés (SUCCEEDED) comme CANCELLED pour qu'ils
 * disparaissent de la liste affichée. Garde intacts les jobs en erreur
 * (FAILED, la cliente veut les voir pour retry), en attente (QUEUED) et
 * en vol (IN_PROGRESS / AWAITING_CALLBACK).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const res = await prisma.marketplaceRefreshJob.updateMany({
    where: { status: "SUCCEEDED" },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ cleared: res.count });
}
