import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runPfsAnalyze } from "@/lib/pfs-analyze";

// ─────────────────────────────────────────────
// POST — Start a new import job (analyze → validate → prepare)
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
    const active = await prisma.pfsPrepareJob.findFirst({
      where: { status: { in: ["RUNNING", "ANALYZING"] } },
      select: { id: true },
    });

    if (active) {
      return NextResponse.json(
        { error: "Une importation est déjà en cours.", jobId: active.id },
        { status: 409 },
      );
    }

    // Create the job in ANALYZING state
    const job = await prisma.pfsPrepareJob.create({
      data: {
        status: "ANALYZING",
        adminId: session.user.id,
      },
    });

    // Fire-and-forget analyze (will transition to RUNNING or NEEDS_VALIDATION)
    runPfsAnalyze(job.id, { limit }).catch(console.error);

    return NextResponse.json({
      jobId: job.id,
      limit,
    });
  } catch (error) {
    console.error("[PFS Import] Error starting import job:", error);
    return NextResponse.json(
      { error: "Erreur lors du lancement de l'importation" },
      { status: 500 },
    );
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

    const job = await prisma.pfsPrepareJob.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job non trouvé" }, { status: 404 });
    }

    if (job.status !== "RUNNING" && job.status !== "PENDING" && job.status !== "ANALYZING") {
      return NextResponse.json({ error: "Le job n'est pas en cours" }, { status: 400 });
    }

    // Set status to STOPPED — the running process will detect this and stop gracefully
    await prisma.pfsPrepareJob.update({
      where: { id },
      data: { status: "STOPPED" },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PFS Prepare] Error stopping job:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'arrêt du job" },
      { status: 500 },
    );
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
      job = await prisma.pfsPrepareJob.findUnique({
        where: { id },
      });
    } else {
      job = await prisma.pfsPrepareJob.findFirst({
        orderBy: { createdAt: "desc" },
      });
    }

    if (!job) {
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error("[PFS Prepare] Error fetching prepare job:", error);
    return NextResponse.json(
      { error: "Erreur lors de la récupération du job" },
      { status: 500 },
    );
  }
}
