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

  // Fetch linked error drafts (their tempDir points to the public/uploads/temp/import_errors_* folder
  // that holds the preview images for failed rows — must be purged from disk too).
  const draftIds = jobs.map((j) => j.errorDraftId).filter(Boolean) as string[];
  const drafts =
    draftIds.length > 0
      ? await prisma.importDraft.findMany({
          where: { id: { in: draftIds } },
          select: { id: true, tempDir: true },
        })
      : [];

  // Delete associated drafts from DB
  if (draftIds.length > 0) {
    await prisma.importDraft.deleteMany({ where: { id: { in: draftIds } } });
  }

  // Delete jobs from DB
  const result = await prisma.importJob.deleteMany({
    where: { id: { in: jobs.map((j) => j.id) } },
  });

  // Cleanup files (best-effort, don't fail if files are missing)
  const dirsToRemove: string[] = [];
  const filesToRemove: string[] = [];
  for (const job of jobs) {
    if (job.filePath) filesToRemove.push(job.filePath);
    if (job.tempDir) dirsToRemove.push(job.tempDir);
  }
  for (const draft of drafts) {
    if (draft.tempDir) dirsToRemove.push(draft.tempDir);
  }

  for (const rel of filesToRemove) {
    try {
      await rm(path.resolve(process.cwd(), rel), { force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  for (const rel of dirsToRemove) {
    try {
      await rm(path.resolve(process.cwd(), rel), {
        recursive: true,
        force: true,
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  return { deleted: result.count };
}
