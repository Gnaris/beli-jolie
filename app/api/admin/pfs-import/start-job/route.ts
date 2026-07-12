import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { processPfsImport, type PfsImportItem } from "@/lib/pfs-import-processor";
import { requireCurrentTenant } from "@/lib/tenant";
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

  const tenant = await requireCurrentTenant();

  try {
    const body = await req.json();
    const items: PfsImportItem[] = body.items ?? [];

    if (items.length === 0) {
      return NextResponse.json({ error: "Aucun produit sélectionné" }, { status: 400 });
    }

    // Verrou anti-double-import : un seul job PFS peut tourner à la fois,
    // tous admins confondus. Empêche les double-clics et le scénario où l'UI
    // a "oublié" un job en cours et propose de relancer.
    const inFlight = await prisma.importJob.findFirst({
      where: {
        type: "PFS_IMPORT",
        status: { in: ["PENDING", "PROCESSING"] },
      },
      select: { id: true },
    });
    if (inFlight) {
      return NextResponse.json(
        { error: "Un import PFS est déjà en cours. Veuillez attendre qu'il se termine avant d'en relancer un." },
        { status: 409 },
      );
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

    // Fire-and-forget — le tenantSlug est capturé ici car le processor
    // background ne peut plus lire les headers de requête.
    processPfsImport(job.id, tenant.slug).catch((err) => {
      logger.error("[pfs-import/start-job] Background processing error", {
        jobId: job.id,
        error: err,
      });
    });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    logger.error("[pfs-import/start-job] POST error", {
      error: err,
    });
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
