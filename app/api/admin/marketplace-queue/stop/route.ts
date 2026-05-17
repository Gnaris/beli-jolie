/**
 * POST /api/admin/marketplace-queue/stop
 *
 * Annule tous les jobs encore QUEUED (en attente). N'interrompt PAS les jobs
 * IN_PROGRESS / AWAITING_CALLBACK pour éviter de casser un appel marketplace
 * en cours.
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
    where: { status: "QUEUED" },
    data: { status: "CANCELLED", completedAt: new Date() },
  });

  return NextResponse.json({ cancelled: res.count });
}
