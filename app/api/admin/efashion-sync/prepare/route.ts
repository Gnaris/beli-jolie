import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { PfsSyncStatus } from "@prisma/client";
import { runEfashionPrepare } from "@/lib/efashion-prepare";

// ─────────────────────────────────────────────
// POST — Start prepare phase directly (skip analyze)
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    let limit = 0;
    try {
      const body = await req.json();
      limit = typeof body.limit === "number" ? body.limit : 0;
    } catch {
      // No body
    }

    // Check if a job is already running
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

    // Create the job in RUNNING state (skip analyze)
    const job = await prisma.efashionPrepareJob.create({
      data: {
        status: PfsSyncStatus.RUNNING,
        adminId: session.user.id,
      },
    });

    // Fire-and-forget prepare
    runEfashionPrepare(job.id, { limit }).catch((err) =>
      logger.error("[eFashion Import] Prepare failed", {
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    return NextResponse.json({ jobId: job.id, limit });
  } catch (error) {
    logger.error("[eFashion Prepare] Error starting prepare job", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Erreur lors du lancement de la préparation" },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────
// GET — Get prepare job + staged product counts or paginated products
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const id = searchParams.get("id");
    const wantProducts = searchParams.get("products") === "true";
    const status = searchParams.get("status");
    const skip = parseInt(searchParams.get("skip") || "0", 10);
    const take = Math.min(100, parseInt(searchParams.get("take") || "50", 10));

    if (!id) {
      return NextResponse.json({ error: "ID requis" }, { status: 400 });
    }

    const job = await prisma.efashionPrepareJob.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: "Job non trouvé" }, { status: 404 });
    }

    if (wantProducts) {
      // Return paginated staged products
      const where: Record<string, unknown> = { prepareJobId: id };
      if (status) {
        where.status = status;
      }

      const [products, total] = await Promise.all([
        prisma.efashionStagedProduct.findMany({
          where,
          orderBy: { createdAt: "asc" },
          skip,
          take,
        }),
        prisma.efashionStagedProduct.count({ where }),
      ]);

      return NextResponse.json({ job, products, total, skip, take });
    }

    // Return job with counts by status
    const statusCounts = await prisma.efashionStagedProduct.groupBy({
      by: ["status"],
      where: { prepareJobId: id },
      _count: true,
    });

    const counts: Record<string, number> = {};
    for (const row of statusCounts) {
      counts[row.status] = row._count;
    }

    return NextResponse.json({ job, counts });
  } catch (error) {
    logger.error("[eFashion Prepare] Error fetching prepare data", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Erreur lors de la récupération des données" },
      { status: 500 },
    );
  }
}
