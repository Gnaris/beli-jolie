/**
 * Tests unitaires de la file d'attente images en arrière-plan.
 *
 * Vérifie le contrat public — enqueue, retry, listing — en mockant `prisma`
 * et `fs`. Le worker lui-même tourne via setInterval ; on ne le démarre pas
 * dans ces tests. La couverture du flow complet (worker → sharp → flags
 * sync) vit dans les tests d'intégration `__tests__/integration/` (DB
 * réelle) — ces tests-ci verrouillent le contrat de surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/image-processor", () => ({
  processProductImage: vi.fn().mockResolvedValue({ dbPath: "/x.webp", sizes: { large: 1, medium: 1, thumb: 1 } }),
}));

const prismaMock: any = {
  imageProcessingJob: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  product: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// fs.promises pour le helper d'écriture de buffer brut
const fsMock = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake")),
  unlink: vi.fn().mockResolvedValue(undefined),
};
vi.mock("node:fs", () => ({
  promises: fsMock,
}));

const { enqueueImageJob, listRecentImageJobs, retryFailedImageJob } = await import("@/lib/image-queue");

beforeEach(() => {
  Object.values(prismaMock.imageProcessingJob).forEach((fn: any) => fn.mockReset?.());
  Object.values(prismaMock.product).forEach((fn: any) => fn.mockReset?.());
  fsMock.mkdir.mockClear();
  fsMock.writeFile.mockClear();
  fsMock.readFile.mockClear();
  fsMock.unlink.mockClear();
});

describe("enqueueImageJob", () => {
  it("écrit le buffer brut sur disque et insère un job PENDING", async () => {
    prismaMock.imageProcessingJob.create.mockResolvedValue({
      id: "job-123",
      dbPath: "/uploads/produits/E1/E1-noir-1.webp",
    });

    const out = await enqueueImageJob({
      rawBuffer: Buffer.from("hello"),
      fileExt: "jpg",
      productId: "p-1",
      destDir: "uploads/produits/e1",
      filename: "e1-noir-1",
      dbPath: "/uploads/produits/E1/E1-noir-1.webp",
    });

    expect(fsMock.mkdir).toHaveBeenCalledTimes(1);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    expect(prismaMock.imageProcessingJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: "p-1",
          destDir: "uploads/produits/e1",
          filename: "e1-noir-1",
          dbPath: "/uploads/produits/E1/E1-noir-1.webp",
          status: "PENDING",
        }),
      }),
    );
    expect(out.jobId).toBe("job-123");
    expect(out.dbPath).toBe("/uploads/produits/E1/E1-noir-1.webp");
  });

  it("accepte productId null pour les brouillons (pas encore créés en BDD)", async () => {
    prismaMock.imageProcessingJob.create.mockResolvedValue({ id: "job-0", dbPath: "/x.webp" });

    await enqueueImageJob({
      rawBuffer: Buffer.from(""),
      fileExt: "png",
      productId: null,
      destDir: "uploads/produits/_brouillon",
      filename: "brouillon-noir-x",
      dbPath: "/uploads/produits/_brouillon/brouillon-noir-x.webp",
    });

    expect(prismaMock.imageProcessingJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ productId: null }),
      }),
    );
  });
});

describe("retryFailedImageJob", () => {
  it("repasse en PENDING uniquement les jobs FAILED (idempotent)", async () => {
    prismaMock.imageProcessingJob.updateMany.mockResolvedValue({ count: 1 });

    await retryFailedImageJob("job-failed-1");

    expect(prismaMock.imageProcessingJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-failed-1", status: "FAILED" },
      data: { status: "PENDING", error: null, startedAt: null, completedAt: null },
    });
  });

  it("ne change rien si le job n'est pas FAILED (race avec retraitement)", async () => {
    prismaMock.imageProcessingJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(retryFailedImageJob("job-x")).resolves.toBeUndefined();
  });
});

describe("listRecentImageJobs", () => {
  it("filtre par productId si fourni", async () => {
    prismaMock.imageProcessingJob.findMany.mockResolvedValue([]);
    await listRecentImageJobs({ productId: "p-1" });
    const call = prismaMock.imageProcessingJob.findMany.mock.calls[0][0];
    expect(call.where.productId).toBe("p-1");
    // Toujours filtré sur createdAt >= 6h pour éviter les vieux jobs
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("respecte la limite passée (entre 1 et 500)", async () => {
    prismaMock.imageProcessingJob.findMany.mockResolvedValue([]);
    await listRecentImageJobs({ limit: 42 });
    expect(prismaMock.imageProcessingJob.findMany.mock.calls[0][0].take).toBe(42);
  });

  it("utilise une limite par défaut raisonnable si non spécifiée", async () => {
    prismaMock.imageProcessingJob.findMany.mockResolvedValue([]);
    await listRecentImageJobs();
    expect(prismaMock.imageProcessingJob.findMany.mock.calls[0][0].take).toBe(200);
  });

  it("renvoie les champs utiles pour le widget UI", async () => {
    const fakeJobs = [
      { id: "j1", productId: "p1", status: "DONE", error: null, createdAt: new Date(), completedAt: new Date() },
    ];
    prismaMock.imageProcessingJob.findMany.mockResolvedValue(fakeJobs);
    const out = await listRecentImageJobs();
    expect(out).toEqual(fakeJobs);
  });
});
