import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 20;

// ─────────────────────────────────────────────
// GET — Paginated history of ALL import jobs
// Query params: type, status, page
// ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get("type") as "PRODUCTS" | "IMAGES" | null;
    const status = searchParams.get("status") as "COMPLETED" | "FAILED" | null;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);

    // Build where clause
    const where: Record<string, unknown> = {};
    if (type === "PRODUCTS" || type === "IMAGES") {
      where.type = type;
    }
    if (status === "COMPLETED" || status === "FAILED") {
      where.status = status;
    }

    // Count total matching jobs
    const total = await prisma.importJob.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    // Fetch paginated jobs
    const jobs = await prisma.importJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    });

    // Collect errorDraftIds that exist
    const draftIds = jobs
      .map((j) => j.errorDraftId)
      .filter((id): id is string => !!id);

    // Fetch associated drafts in one query
    const drafts =
      draftIds.length > 0
        ? await prisma.importDraft.findMany({
            where: { id: { in: draftIds } },
            select: {
              id: true,
              status: true,
              errorRows: true,
              successRows: true,
            },
          })
        : [];

    const draftMap = new Map(drafts.map((d) => [d.id, d]));

    // Shape response
    const jobsResponse = jobs.map((job) => ({
      id: job.id,
      type: job.type,
      status: job.status,
      filename: job.filename,
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      successItems: job.successItems,
      errorItems: job.errorItems,
      errorDraftId: job.errorDraftId,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      draft: job.errorDraftId ? draftMap.get(job.errorDraftId) ?? null : null,
    }));

    return NextResponse.json({
      jobs: jobsResponse,
      total,
      page,
      totalPages,
    });
  } catch (err) {
    console.error("[import-jobs/history] GET error:", err);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
