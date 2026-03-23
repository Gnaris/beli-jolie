import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PfsStagedStatus } from "@prisma/client";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") return null;
  return session;
}

const VALID_STATUSES: PfsStagedStatus[] = [
  "PREPARING",
  "READY",
  "APPROVED",
  "REJECTED",
  "ERROR",
];

// ─────────────────────────────────────────────
// GET — List staged products with pagination & filters
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session)
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const jobId = searchParams.get("jobId");
  const statusParam = searchParams.get("status");
  const search = searchParams.get("search");
  const existsParam = searchParams.get("existsInDb"); // "true" | "false" | null
  const idsOnly = searchParams.get("idsOnly") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "20", 10)));

  if (!jobId) {
    return NextResponse.json(
      { error: "Le paramètre jobId est requis" },
      { status: 400 }
    );
  }

  // Validate status if provided
  if (statusParam && !VALID_STATUSES.includes(statusParam as PfsStagedStatus)) {
    return NextResponse.json(
      { error: `Statut invalide. Valeurs possibles : ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  // Build where clause
  const where: Record<string, unknown> = { prepareJobId: jobId };

  if (statusParam) {
    where.status = statusParam as PfsStagedStatus;
  }

  if (existsParam === "true") {
    where.existsInDb = true;
  } else if (existsParam === "false") {
    where.existsInDb = false;
  }

  if (search) {
    where.OR = [
      { reference: { contains: search } },
      { name: { contains: search } },
    ];
  }

  // Fast path: return only IDs (no pagination, for "select all across pages")
  if (idsOnly) {
    const allIds = await prisma.pfsStagedProduct.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ids: allIds.map((r) => r.id) });
  }

  const [products, total, countsByStatus, existingCount, newCount] = await Promise.all([
    prisma.pfsStagedProduct.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pfsStagedProduct.count({ where }),
    prisma.pfsStagedProduct.groupBy({
      by: ["status"],
      where: { prepareJobId: jobId },
      _count: true,
    }),
    prisma.pfsStagedProduct.count({ where: { prepareJobId: jobId, existsInDb: true } }),
    prisma.pfsStagedProduct.count({ where: { prepareJobId: jobId, existsInDb: false } }),
  ]);

  const counts = {
    ready: 0,
    approved: 0,
    rejected: 0,
    preparing: 0,
    error: 0,
  };
  for (const row of countsByStatus) {
    const key = row.status.toLowerCase() as keyof typeof counts;
    if (key in counts) counts[key] = row._count;
  }

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({ products, total, page, totalPages, counts, existsCounts: { existing: existingCount, new: newCount } });
}
