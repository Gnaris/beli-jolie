"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rm } from "fs/promises";
import path from "path";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    throw new Error("Accès non autorisé.");
  }
  return session;
}

// ─────────────────────────────────────────────
// Delete import jobs by IDs
// ─────────────────────────────────────────────

export async function deleteImportJobs(ids: string[]): Promise<{ deleted: number }> {
  await requireAdmin();

  if (!ids.length || ids.length > 200) {
    throw new Error("Sélection invalide.");
  }

  // Fetch jobs to get file paths for cleanup
  const jobs = await prisma.importJob.findMany({
    where: { id: { in: ids } },
    select: { id: true, filePath: true, tempDir: true, errorDraftId: true },
  });

  if (jobs.length === 0) {
    throw new Error("Aucun import trouvé.");
  }

  // Delete associated drafts
  const draftIds = jobs.map((j) => j.errorDraftId).filter(Boolean) as string[];
  if (draftIds.length > 0) {
    await prisma.importDraft.deleteMany({ where: { id: { in: draftIds } } });
  }

  // Delete jobs from DB
  const result = await prisma.importJob.deleteMany({
    where: { id: { in: jobs.map((j) => j.id) } },
  });

  // Cleanup files (best-effort, don't fail if files are missing)
  for (const job of jobs) {
    try {
      if (job.filePath) {
        const absPath = path.resolve(process.cwd(), job.filePath);
        await rm(absPath, { force: true });
      }
      if (job.tempDir) {
        const absDir = path.resolve(process.cwd(), job.tempDir);
        await rm(absDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  return { deleted: result.count };
}
