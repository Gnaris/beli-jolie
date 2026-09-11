/**
 * Tests pour lib/bulk-mail-worker.ts — API publique enqueue/list/dismiss.
 * Le corps du worker (processJob) n'est pas testé unitairement (dépend de
 * beaucoup de mocks branchés — testé par le flow send-newsletter-fiches).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  bulkMailJob: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  enqueueBulkMailJob,
  listRecentBulkMailJobs,
  dismissBulkMailJob,
} from "@/lib/bulk-mail-worker";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enqueueBulkMailJob", () => {
  it("crée un BulkMailJob avec chaque destinataire en WAITING", async () => {
    mockPrisma.bulkMailJob.create.mockResolvedValue({ id: "job-1" });

    const res = await enqueueBulkMailJob({
      tenantId: "tenant-1",
      templateId: "tpl-1",
      templateName: "Nouveautés",
      templateSubject: "Découvrez nos nouveautés",
      recipients: [
        { ficheId: "f-1", email: "a@shop.fr", name: "Alice" },
        { ficheId: "f-2", email: "b@shop.fr", name: "Bob" },
      ],
    });

    expect(res.jobId).toBe("job-1");
    expect(mockPrisma.bulkMailJob.create).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.bulkMailJob.create.mock.calls[0][0] as {
      data: {
        tenantId: string;
        templateId: string;
        templateName: string;
        recipients: Array<{ ficheId: string; email: string; name: string; status: string }>;
        totalCount: number;
      };
    };
    expect(arg.data.tenantId).toBe("tenant-1");
    expect(arg.data.templateName).toBe("Nouveautés");
    expect(arg.data.totalCount).toBe(2);
    expect(arg.data.recipients).toEqual([
      { ficheId: "f-1", email: "a@shop.fr", name: "Alice", status: "WAITING" },
      { ficheId: "f-2", email: "b@shop.fr", name: "Bob", status: "WAITING" },
    ]);
  });
});

describe("listRecentBulkMailJobs", () => {
  it("filtre sur PENDING/RUNNING + COMPLETED/FAILED récents non dismiss", async () => {
    mockPrisma.bulkMailJob.findMany.mockResolvedValue([]);
    await listRecentBulkMailJobs();
    expect(mockPrisma.bulkMailJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: { in: ["PENDING", "RUNNING"] } }),
            expect.objectContaining({
              status: { in: ["COMPLETED", "FAILED"] },
              dismissedAt: null,
            }),
          ]),
        }),
      }),
    );
  });
});

describe("dismissBulkMailJob", () => {
  it("pose dismissedAt sur le job ciblé", async () => {
    mockPrisma.bulkMailJob.update.mockResolvedValue({});
    await dismissBulkMailJob("job-1");
    expect(mockPrisma.bulkMailJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ dismissedAt: expect.any(Date) }),
      }),
    );
  });

  it("ne throw pas si le job a disparu (soft-fail)", async () => {
    mockPrisma.bulkMailJob.update.mockRejectedValue(new Error("not found"));
    await expect(dismissBulkMailJob("job-inexistant")).resolves.toBeUndefined();
  });
});
