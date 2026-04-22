import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * POST — Cancel a running PFS import job
 * Body: { jobId: string }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { jobId } = await req.json();
    if (!jobId) {
      return NextResponse.json({ error: "jobId manquant" }, { status: 400 });
    }

    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.adminId !== session.user.id) {
      return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
    }

    if (job.status === "COMPLETED" || job.status === "FAILED" || job.status === "CANCELLED") {
      return NextResponse.json({ error: "Ce job est déjà terminé" }, { status: 400 });
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED" },
    });

    logger.info("[pfs-import/cancel-job] Job cancelled", { jobId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("[pfs-import/cancel-job] POST error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
