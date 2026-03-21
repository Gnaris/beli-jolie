import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runPfsSync } from "@/lib/pfs-sync";

// ─────────────────────────────────────────────
// POST — Resume a failed/stopped sync job
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const jobId = body.jobId as string;

    if (!jobId) {
      return NextResponse.json({ error: "jobId requis" }, { status: 400 });
    }

    const job = await prisma.pfsSyncJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
    }

    if (job.status === "RUNNING") {
      return NextResponse.json({ error: "Ce job est déjà en cours" }, { status: 409 });
    }

    if (job.status === "COMPLETED") {
      return NextResponse.json({ error: "Ce job est déjà terminé" }, { status: 400 });
    }

    // Reset status to allow resume
    await prisma.pfsSyncJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        errorMessage: null,
      },
    });

    // Start sync in background (will resume from lastPage)
    runPfsSync(jobId).catch(() => {});

    return NextResponse.json({ jobId, resumeFromPage: job.lastPage + 1 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
