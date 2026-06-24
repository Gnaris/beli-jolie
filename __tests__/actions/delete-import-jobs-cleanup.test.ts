/**
 * Tests for deleteImportJobs — verify that the linked ImportDraft.tempDir
 * (the public/uploads/temp/import_errors_* folder holding preview images
 * for failed rows) is also purged from disk, not just removed from DB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  importJob: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  importDraft: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
const mockRm = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("fs/promises", () => ({ rm: mockRm }));

import { deleteImportJobs } from "@/app/actions/admin/import-jobs";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
  mockPrisma.importJob.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.importDraft.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.importDraft.findMany.mockResolvedValue([]);
  mockRm.mockResolvedValue(undefined);
});

describe("deleteImportJobs — disk cleanup", () => {
  it("supprime le filePath, le tempDir du job ET le tempDir du draft d'erreurs", async () => {
    mockPrisma.importJob.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        filePath: "private/uploads/import-jobs/file.xlsx",
        tempDir: "private/uploads/import-jobs/import_job_123",
        errorDraftId: "draft-1",
      },
    ]);
    mockPrisma.importDraft.findMany.mockResolvedValueOnce([
      { id: "draft-1", tempDir: "uploads/temp/import_errors_456" },
    ]);
    mockPrisma.importJob.deleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await deleteImportJobs(["job-1"]);

    expect(res.deleted).toBe(1);
    const calls = mockRm.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain(
      path.resolve(process.cwd(), "private/uploads/import-jobs/file.xlsx"),
    );
    expect(calls).toContain(
      path.resolve(
        process.cwd(),
        "private/uploads/import-jobs/import_job_123",
      ),
    );
    expect(calls).toContain(
      path.resolve(process.cwd(), "uploads/temp/import_errors_456"),
    );
  });

  it("ne tente aucune suppression de draft si errorDraftId est null", async () => {
    mockPrisma.importJob.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        filePath: "private/uploads/import-jobs/file.xlsx",
        tempDir: null,
        errorDraftId: null,
      },
    ]);
    mockPrisma.importJob.deleteMany.mockResolvedValueOnce({ count: 1 });

    await deleteImportJobs(["job-1"]);

    expect(mockPrisma.importDraft.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.importDraft.deleteMany).not.toHaveBeenCalled();
    expect(mockRm).toHaveBeenCalledTimes(1);
  });

  it("ne plante pas si rm échoue sur l'un des chemins", async () => {
    mockPrisma.importJob.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        filePath: "private/uploads/import-jobs/file.xlsx",
        tempDir: null,
        errorDraftId: "draft-1",
      },
    ]);
    mockPrisma.importDraft.findMany.mockResolvedValueOnce([
      { id: "draft-1", tempDir: "uploads/temp/import_errors_456" },
    ]);
    mockPrisma.importJob.deleteMany.mockResolvedValueOnce({ count: 1 });
    mockRm.mockRejectedValueOnce(new Error("EACCES"));

    await expect(deleteImportJobs(["job-1"])).resolves.toEqual({ deleted: 1 });
  });

  it("ignore les drafts sans tempDir", async () => {
    mockPrisma.importJob.findMany.mockResolvedValueOnce([
      {
        id: "job-1",
        filePath: null,
        tempDir: null,
        errorDraftId: "draft-1",
      },
    ]);
    mockPrisma.importDraft.findMany.mockResolvedValueOnce([
      { id: "draft-1", tempDir: null },
    ]);
    mockPrisma.importJob.deleteMany.mockResolvedValueOnce({ count: 1 });

    await deleteImportJobs(["job-1"]);

    expect(mockRm).not.toHaveBeenCalled();
  });

  it("refuse si l'utilisateur n'est pas admin", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });

    await expect(deleteImportJobs(["job-1"])).rejects.toThrow(/Accès/);
  });

  it("refuse une sélection vide ou trop grande", async () => {
    await expect(deleteImportJobs([])).rejects.toThrow(/Sélection/);
    await expect(deleteImportJobs(Array(201).fill("x"))).rejects.toThrow(
      /Sélection/,
    );
  });
});
