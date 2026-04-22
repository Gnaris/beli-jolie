import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processPfsImport, type PfsImportItem } from "@/lib/pfs-import-processor";
import { logger } from "@/lib/logger";

export const maxDuration = 300;

/**
 * POST — Start a PFS import job
 * Body: { items: [{ pfsId, reference, name }] }
 * Creates an ImportJob and starts background processing.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const items: PfsImportItem[] = body.items ?? [];

    if (items.length === 0) {
      return NextResponse.json({ error: "Aucun produit sélectionné" }, { status: 400 });
    }

    const job = await prisma.importJob.create({
      data: {
        type: "PFS_IMPORT",
        status: "PENDING",
        filename: `PFS Import (${items.length} produits)`,
        totalItems: items.length,
        resultDetails: { items },
        adminId: session.user.id,
      },
    });

    // Fire-and-forget
    processPfsImport(job.id).catch((err) => {
      logger.error("[pfs-import/start-job] Background processing error", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    logger.error("[pfs-import/start-job] POST error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
