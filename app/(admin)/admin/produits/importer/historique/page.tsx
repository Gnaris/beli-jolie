import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ImportHistoryClient from "@/components/admin/products/import/ImportHistoryClient";

export const metadata: Metadata = {
  title: "Historique des imports",
};

const PAGE_SIZE = 20;

export default async function ImportHistoriquePage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/connexion");

  // Fetch first page of import jobs (newest first)
  const [jobs, total] = await Promise.all([
    prisma.importJob.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.importJob.count(),
  ]);

  // Fetch associated ImportDraft records for jobs with errorDraftId
  const draftIds = jobs
    .map((j) => j.errorDraftId)
    .filter((id): id is string => !!id);

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

  // Shape data for client component
  const jobsData = jobs.map((job) => ({
    id: job.id,
    type: job.type as "PRODUCTS" | "IMAGES",
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <ImportHistoryClient
      initialJobs={jobsData}
      initialTotal={total}
      initialTotalPages={totalPages}
    />
  );
}
