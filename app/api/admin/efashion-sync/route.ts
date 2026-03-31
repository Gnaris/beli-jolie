import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PfsSyncStatus } from "@prisma/client";
import { runEfashionAnalyze } from "@/lib/efashion-analyze";

// ─────────────────────────────────────────────
// POST — Start a new eFashion prepare job (analyze phase)
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    // Parse optional limit from body
    let limit = 0;
    try {
      const body = await req.json();
      limit = typeof body.limit === "number" ? body.limit : 0;
    } catch {
      // No body or invalid JSON — default to unlimited
    }

    // Check if a job is already running or analyzing
    const active = await prisma.efashionPrepareJob.findFirst({
      where: { status: { in: [PfsSyncStatus.RUNNING, PfsSyncStatus.ANALYZING] } },
      select: { id: true },
    });

    if (active) {
      return NextResponse.json(
        { error: "Une importation eFashion est déjà en cours.", jobId: active.id },
        { status: 409 },
      );
    }

    // Create the job in ANALYZING state
    const job = await prisma.efashionPrepareJob.create({
      data: {
        status: PfsSyncStatus.ANALYZING,
        adminId: session.user.id,
      },
    });

    // Fire-and-forget analyze (will transition to NEEDS_VALIDATION or RUNNING)
    runEfashionAnalyze(job.id, { limit }).catch((err) =>
      logger.error("[eFashion Import] Analyze failed", { error: err instanceof Error ? err.message : String(err) }),
    );

    return NextResponse.json({ jobId: job.id, limit });
  } catch (error) {
    logger.error("[eFashion Import] Error starting import job", { error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : "Erreur lors du lancement de l'importation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// DELETE — Stop a running prepare job
// ─────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID requis" }, { status: 400 });
    }

    const job = await prisma.efashionPrepareJob.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job non trouvé" }, { status: 404 });
    }

    if (job.status !== PfsSyncStatus.RUNNING && job.status !== PfsSyncStatus.PENDING && job.status !== PfsSyncStatus.ANALYZING) {
      return NextResponse.json({ error: "Le job n'est pas en cours" }, { status: 400 });
    }

    await prisma.efashionPrepareJob.update({
      where: { id },
      data: { status: PfsSyncStatus.STOPPED },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[eFashion Prepare] Error stopping job", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Erreur lors de l'arrêt du job" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// GET — Get latest prepare job or specific one
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    let job;

    if (id) {
      job = await prisma.efashionPrepareJob.findUnique({ where: { id } });
    } else {
      job = await prisma.efashionPrepareJob.findFirst({
        orderBy: { createdAt: "desc" },
      });
    }

    if (!job) {
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({ job });
  } catch (error) {
    logger.error("[eFashion Prepare] Error fetching job", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Erreur lors de la récupération du job" }, { status: 500 });
  }
}
