import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────
// GET — Paginated list of eFashion prepare jobs
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") || "10", 10)));

  const [jobsRaw, total] = await Promise.all([
    prisma.efashionPrepareJob.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        status: true,
        totalProducts: true,
        processedProducts: true,
        readyProducts: true,
        errorProducts: true,
        approvedProducts: true,
        rejectedProducts: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.efashionPrepareJob.count(),
  ]);

  // Fetch per-job staged product stats
  const jobIds = jobsRaw.map((j) => j.id);
  const [stagedCounts, pendingCounts] = jobIds.length > 0
    ? await Promise.all([
        prisma.efashionStagedProduct.groupBy({
          by: ["prepareJobId", "existsInDb"],
          where: { prepareJobId: { in: jobIds } },
          _count: true,
        }),
        prisma.efashionStagedProduct.groupBy({
          by: ["prepareJobId"],
          where: {
            prepareJobId: { in: jobIds },
            status: "READY",
          },
          _count: true,
        }),
      ])
    : [[], []];

  // Build lookup maps
  const existingMap = new Map<string, number>();
  for (const row of stagedCounts) {
    if (row.existsInDb) {
      existingMap.set(row.prepareJobId, (existingMap.get(row.prepareJobId) || 0) + row._count);
    }
  }
  const pendingMap = new Map<string, number>();
  for (const row of pendingCounts) {
    pendingMap.set(row.prepareJobId, row._count);
  }

  const jobs = jobsRaw.map((j) => ({
    ...j,
    pendingReview: pendingMap.get(j.id) || 0,
    existingCount: existingMap.get(j.id) || 0,
  }));

  return NextResponse.json({ jobs, total, page, totalPages: Math.ceil(total / limit) });
}

// ─────────────────────────────────────────────
// DELETE — Bulk delete jobs
// ─────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "IDs requis" }, { status: 400 });
  }

  // Cascade delete: EfashionStagedProduct has onDelete: Cascade from EfashionPrepareJob
  await prisma.efashionPrepareJob.deleteMany({ where: { id: { in: ids } } });

  return NextResponse.json({ success: true, deleted: ids.length });
}
