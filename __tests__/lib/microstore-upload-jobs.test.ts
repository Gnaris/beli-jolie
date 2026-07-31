/**
 * Tests unitaires des helpers de suivi d'upload Microstore.
 *
 * Vérifie le contrat public : création, incrémentation atomique des
 * compteurs, transitions de statut, tolérance à un `id` null (no-op silencieux
 * — utile quand la table est vide en dev ou que la création a échoué).
 * Prisma est mocké — les tests DB-backed vivent dans __tests__/integration/.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const prismaMock: {
  microstoreUploadJob: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
} = {
  microstoreUploadJob: {
    create: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  createMicrostoreUploadJob,
  updateMicrostoreUploadJob,
  markMicrostoreUploadJobStarted,
  bumpMicrostoreUploadJobCounters,
  markMicrostoreUploadJobStatus,
  RECENT_DONE_WINDOW_MS,
} = await import("@/lib/microstore-upload-jobs");

beforeEach(() => {
  prismaMock.microstoreUploadJob.create.mockReset();
  prismaMock.microstoreUploadJob.update.mockReset();
});

describe("createMicrostoreUploadJob", () => {
  it("insère un job PENDING et renvoie son id", async () => {
    prismaMock.microstoreUploadJob.create.mockResolvedValue({ id: "job-1" });
    const id = await createMicrostoreUploadJob({
      productId: "p-1",
      reference: "REF-1",
      productName: "Bracelet doré",
    });
    expect(id).toBe("job-1");
    expect(prismaMock.microstoreUploadJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "p-1",
          reference: "REF-1",
          productName: "Bracelet doré",
          status: "PENDING",
        }),
      }),
    );
  });

  it("supporte productId=null et productName omis", async () => {
    prismaMock.microstoreUploadJob.create.mockResolvedValue({ id: "job-2" });
    const id = await createMicrostoreUploadJob({
      productId: null,
      reference: "REF-2",
    });
    expect(id).toBe("job-2");
    const data = prismaMock.microstoreUploadJob.create.mock.calls[0][0].data;
    expect(data.productId).toBeNull();
    expect(data.productName).toBeNull();
  });

  it("renvoie null si l'insert échoue — pas d'exception qui remonte", async () => {
    prismaMock.microstoreUploadJob.create.mockRejectedValue(new Error("boom"));
    const id = await createMicrostoreUploadJob({
      productId: "p-1",
      reference: "REF-1",
    });
    expect(id).toBeNull();
  });
});

describe("updateMicrostoreUploadJob", () => {
  it("no-op silencieux si id null", async () => {
    await updateMicrostoreUploadJob(null, { status: "DONE" });
    expect(prismaMock.microstoreUploadJob.update).not.toHaveBeenCalled();
  });

  it("appelle prisma.update quand id fourni", async () => {
    prismaMock.microstoreUploadJob.update.mockResolvedValue({});
    await updateMicrostoreUploadJob("job-1", { status: "DONE" });
    expect(prismaMock.microstoreUploadJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "DONE" },
    });
  });

  it("avale silencieusement une erreur Prisma — on ne veut pas casser l'upload", async () => {
    prismaMock.microstoreUploadJob.update.mockRejectedValue(new Error("db down"));
    await expect(
      updateMicrostoreUploadJob("job-1", { status: "DONE" }),
    ).resolves.toBeUndefined();
  });
});

describe("markMicrostoreUploadJobStarted", () => {
  it("passe UPLOADING avec totalImages et startedAt", async () => {
    prismaMock.microstoreUploadJob.update.mockResolvedValue({});
    await markMicrostoreUploadJobStarted("job-1", 12);
    const args = prismaMock.microstoreUploadJob.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: "job-1" });
    expect(args.data.status).toBe("UPLOADING");
    expect(args.data.totalImages).toBe(12);
    expect(args.data.startedAt).toBeInstanceOf(Date);
  });
});

describe("bumpMicrostoreUploadJobCounters", () => {
  beforeEach(() => {
    prismaMock.microstoreUploadJob.update.mockResolvedValue({});
  });

  it("incrémente uploaded seul", async () => {
    await bumpMicrostoreUploadJobCounters("job-1", { uploaded: 1 });
    expect(prismaMock.microstoreUploadJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { uploadedImages: { increment: 1 }, failedImages: undefined },
    });
  });

  it("incrémente failed seul", async () => {
    await bumpMicrostoreUploadJobCounters("job-1", { failed: 2 });
    expect(prismaMock.microstoreUploadJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { uploadedImages: undefined, failedImages: { increment: 2 } },
    });
  });

  it("no-op si rien à bumper", async () => {
    await bumpMicrostoreUploadJobCounters("job-1", { uploaded: 0, failed: 0 });
    expect(prismaMock.microstoreUploadJob.update).not.toHaveBeenCalled();
  });

  it("no-op si id null", async () => {
    await bumpMicrostoreUploadJobCounters(null, { uploaded: 5 });
    expect(prismaMock.microstoreUploadJob.update).not.toHaveBeenCalled();
  });
});

describe("markMicrostoreUploadJobStatus", () => {
  beforeEach(() => {
    prismaMock.microstoreUploadJob.update.mockResolvedValue({});
  });

  it("pose le statut sans toucher completedAt par défaut", async () => {
    await markMicrostoreUploadJobStatus("job-1", "PATCHING");
    const data = prismaMock.microstoreUploadJob.update.mock.calls[0][0].data;
    expect(data.status).toBe("PATCHING");
    expect(data.completedAt).toBeUndefined();
    expect(data.errorMessage).toBeUndefined();
  });

  it("pose completedAt quand completed:true", async () => {
    await markMicrostoreUploadJobStatus("job-1", "DONE", { completed: true });
    const data = prismaMock.microstoreUploadJob.update.mock.calls[0][0].data;
    expect(data.status).toBe("DONE");
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it("tronque errorMessage à 4000 caractères pour ne pas exploser TEXT", async () => {
    const huge = "x".repeat(6000);
    await markMicrostoreUploadJobStatus("job-1", "FAILED", {
      errorMessage: huge,
      completed: true,
    });
    const data = prismaMock.microstoreUploadJob.update.mock.calls[0][0].data;
    expect(data.errorMessage).toHaveLength(4000);
  });

  it("normalise errorMessage:'' en null", async () => {
    await markMicrostoreUploadJobStatus("job-1", "DONE", {
      errorMessage: null,
      completed: true,
    });
    const data = prismaMock.microstoreUploadJob.update.mock.calls[0][0].data;
    expect(data.errorMessage).toBeNull();
  });
});

describe("RECENT_DONE_WINDOW_MS", () => {
  it("vaut 8 minutes — durée validée pour laisser les terminés visibles sans polluer", () => {
    expect(RECENT_DONE_WINDOW_MS).toBe(8 * 60_000);
  });
});
