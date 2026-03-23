import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pfsTotalProducts } from "@/lib/pfs-api";
import { runPfsPrepare } from "@/lib/pfs-prepare";

// ─────────────────────────────────────────────
// POST — Start a new prepare job
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

    // Check if a prepare job is already running
    const running = await prisma.pfsPrepareJob.findFirst({
      where: { status: "RUNNING" },
      select: { id: true },
    });

    if (running) {
      return NextResponse.json(
        { error: "Une préparation est déjà en cours.", jobId: running.id },
        { status: 409 },
      );
    }

    // Get total products count from PFS
    let totalProducts = 0;
    try {
      totalProducts = await pfsTotalProducts();
    } catch {
      // Non-blocking — will update during prepare
    }

    if (limit > 0) totalProducts = Math.min(totalProducts, limit);

    // Create the prepare job
    const job = await prisma.pfsPrepareJob.create({
      data: {
        status: "RUNNING",
        totalProducts,
        adminId: session.user.id,
      },
    });

    // Fire-and-forget
    runPfsPrepare(job.id, { limit }).catch(console.error);

    return NextResponse.json({
      jobId: job.id,
      totalProducts,
      limit,
    });
  } catch (error) {
    console.error("[PFS Prepare] Error starting prepare job:", error);
    return NextResponse.json(
      { error: "Erreur lors du lancement de la préparation" },
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
