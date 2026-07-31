import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { RECENT_DONE_WINDOW_MS } from "@/lib/microstore-upload-jobs";

/**
 * Liste les jobs d'upload Microstore visibles dans le widget flottant :
 * tout ce qui est actif (PENDING/UPLOADING/PATCHING) + les terminés
 * (DONE/FAILED) récents (fenêtre `RECENT_DONE_WINDOW_MS`). Le tenant courant
 * est appliqué automatiquement par l'extension Prisma scope.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - RECENT_DONE_WINDOW_MS);
    const jobs = await prisma.microstoreUploadJob.findMany({
      where: {
        OR: [
          { status: { in: ["PENDING", "UPLOADING", "PATCHING"] } },
          {
            status: { in: ["DONE", "FAILED"] },
            completedAt: { gte: cutoff },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        reference: true,
        productName: true,
        status: true,
        totalImages: true,
        uploadedImages: true,
        failedImages: true,
        errorMessage: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    logger.error("[microstore-upload-jobs] GET error", { error: err });
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
