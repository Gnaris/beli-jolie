import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runPfsSync } from "@/lib/pfs-sync";
import { pfsTotalProducts } from "@/lib/pfs-api";

// ─────────────────────────────────────────────
// POST — Start a new PFS sync job
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

    // Check if a sync is already running
    const running = await prisma.pfsSyncJob.findFirst({
      where: { status: "RUNNING" },
      select: { id: true },
    });

    if (running) {
      return NextResponse.json(
        { error: "Une synchronisation est déjà en cours.", jobId: running.id },
        { status: 409 },
      );
    }

    // Get total products count from PFS
    let totalProducts = 0;
    try {
      totalProducts = await pfsTotalProducts();
    } catch {
      // Non-blocking — will update during sync
    }

    // Adjust total if limit is set
    if (limit > 0) totalProducts = Math.min(totalProducts, limit);

    // Create sync job
    const job = await prisma.pfsSyncJob.create({
      data: {
        adminId: session.user.id,
        totalProducts,
      },
    });

    // Start sync in background (fire-and-forget)
    runPfsSync(job.id, { limit: limit > 0 ? limit : undefined }).catch(() => {});

    return NextResponse.json({ jobId: job.id, totalProducts, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────
// GET — Get sync job status (latest or by id)
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const jobId = req.nextUrl.searchParams.get("id");

  try {
    let job;
    if (jobId) {
      job = await prisma.pfsSyncJob.findUnique({ where: { id: jobId } });
    } else {
      // Get latest job
      job = await prisma.pfsSyncJob.findFirst({
        orderBy: { createdAt: "desc" },
      });
    }

    if (!job) {
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
