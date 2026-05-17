/**
 * POST /api/admin/marketplace-queue/clear
 *
 * Marque tous les jobs terminés (SUCCEEDED + FAILED) comme CANCELLED pour
 * qu'ils disparaissent de la liste affichée. Garde les jobs encore actifs
 * (QUEUED / IN_PROGRESS / AWAITING_CALLBACK) intacts.
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
    where: { status: { in: ["SUCCEEDED", "FAILED"] } },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ cleared: res.count });
}
