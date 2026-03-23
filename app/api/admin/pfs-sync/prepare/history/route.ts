import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") || "10", 10)));

  const [jobsRaw, total] = await Promise.all([
    prisma.pfsPrepareJob.findMany({
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
    prisma.pfsPrepareJob.count(),
  ]);

  // Fetch per-job staged product stats in parallel
  const jobIds = jobsRaw.map((j) => j.id);
  const [stagedCounts, withDiffCounts, pendingCounts] = jobIds.length > 0
    ? await Promise.all([
        prisma.pfsStagedProduct.groupBy({
          by: ["prepareJobId", "existsInDb"],
          where: { prepareJobId: { in: jobIds } },
          _count: true,
        }),
        prisma.pfsStagedProduct.groupBy({
          by: ["prepareJobId"],
          where: {
            prepareJobId: { in: jobIds },
            existsInDb: true,
            NOT: [
              { differences: { equals: null } },
              { differences: { equals: [] } },
            ],
          },
          _count: true,
        }),
        prisma.pfsStagedProduct.groupBy({
          by: ["prepareJobId"],
          where: {
            prepareJobId: { in: jobIds },
            status: "READY",
          },
          _count: true,
        }),
      ])
    : [[], [], []];

  // Build lookup maps
  const existingMap = new Map<string, number>();
  for (const row of stagedCounts) {
    if (row.existsInDb) {
      existingMap.set(row.prepareJobId, (existingMap.get(row.prepareJobId) || 0) + row._count);
    }
  }
  const diffMap = new Map<string, number>();
  for (const row of withDiffCounts) {
    diffMap.set(row.prepareJobId, row._count);
  }
  const pendingMap = new Map<string, number>();
  for (const row of pendingCounts) {
    pendingMap.set(row.prepareJobId, row._count);
  }

  const jobs = jobsRaw.map((j) => {
    const existingTotal = existingMap.get(j.id) || 0;
    const existingWithDiff = diffMap.get(j.id) || 0;
    return {
      ...j,
      pendingReview: pendingMap.get(j.id) || 0,
      existingNoDiff: existingTotal - existingWithDiff,
      existingWithDiff,
    };
  });

  return NextResponse.json({ jobs, total, page, totalPages: Math.ceil(total / limit) });
}

// DELETE - bulk delete jobs
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN")
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: "IDs requis" }, { status: 400 });

  // Cascade delete: PfsStagedProduct has onDelete: Cascade from PfsPrepareJob
  await prisma.pfsPrepareJob.deleteMany({ where: { id: { in: ids } } });

  return NextResponse.json({ success: true, deleted: ids.length });
}
