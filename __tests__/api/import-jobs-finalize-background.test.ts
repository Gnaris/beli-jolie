/**
 * Vérifie le mode fire-and-forget du finalize d'un ImportJob d'images.
 *
 * Pourquoi : avant ce fix, la fermeture/changement de page côté client
 * interrompait la requête finalize avant que le serveur passe le job en
 * COMPLETED, laissant le job bloqué en UPLOADING. Désormais le serveur
 * répond immédiatement et termine le travail en arrière-plan.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    importJob: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/import-processor", () => ({
  processImageBatch: vi.fn(),
  finalizeImageImport: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { finalizeImageImport } from "@/lib/import-processor";
import { POST } from "@/app/api/admin/import-jobs/[id]/route";

function makeFinalizeReq(): NextRequest {
  const fd = new FormData();
  fd.append("action", "finalize");
  return new NextRequest("http://x/api/admin/import-jobs/job-1", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { id: "admin-1", role: "ADMIN" },
  });
  (prisma.importJob.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "job-1",
    type: "IMAGES",
    tempDir: "private/uploads/import-jobs/import_job_1",
    status: "UPLOADING",
    adminId: "admin-1",
  });
  (prisma.importJob.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (finalizeImageImport as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

describe("POST /api/admin/import-jobs/[id] action=finalize — fire-and-forget", () => {
  it("retourne 200 avec queued:true immédiatement", async () => {
    const res = await POST(makeFinalizeReq(), { params: Promise.resolve({ id: "job-1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, queued: true });
  });

  it("passe le statut à PROCESSING avant de retourner", async () => {
    await POST(makeFinalizeReq(), { params: Promise.resolve({ id: "job-1" }) });
    expect(prisma.importJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "PROCESSING" },
    });
  });

  it("ne bloque PAS la réponse en attendant finalizeImageImport", async () => {
    // finalizeImageImport prend artificiellement 200ms à résoudre.
    let resolveFinalize: (() => void) | null = null;
    (finalizeImageImport as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((r) => { resolveFinalize = r; }),
    );

    const t0 = Date.now();
    const res = await POST(makeFinalizeReq(), { params: Promise.resolve({ id: "job-1" }) });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(150); // réponse rapide même si finalize tarde
    expect(finalizeImageImport).toHaveBeenCalledWith("job-1");

    // Libère la promesse pour ne pas laisser le worker pendre.
    resolveFinalize?.();
  });

  it("refuse si le job n'est pas en UPLOADING", async () => {
    (prisma.importJob.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "job-1",
      type: "IMAGES",
      tempDir: "private/uploads/import-jobs/import_job_1",
      status: "COMPLETED",
      adminId: "admin-1",
    });
    const res = await POST(makeFinalizeReq(), { params: Promise.resolve({ id: "job-1" }) });
    expect(res.status).toBe(400);
    expect(finalizeImageImport).not.toHaveBeenCalled();
  });

  it("marque le job FAILED si finalize plante en arrière-plan", async () => {
    (finalizeImageImport as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("kaboom"),
    );

    const res = await POST(makeFinalizeReq(), { params: Promise.resolve({ id: "job-1" }) });
    expect(res.status).toBe(200);

    // Laisse la micro-task de fond se résoudre.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(prisma.importJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "FAILED",
        errorMessage: "kaboom",
      },
    });
  });
});
