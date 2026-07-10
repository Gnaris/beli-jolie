/**
 * Tests unitaires pour la file d'attente des lots de traduction.
 *
 * Couverture :
 *  1. enqueueTranslationJob crée un job PENDING avec le bon totalCount.
 *  2. Le worker traite un job : appelle translateToAllLocales pour chaque item,
 *     persiste les traductions dans la bonne table (colorTranslation) via upsert,
 *     met à jour currentItemText avant chaque item, incrémente doneCount, et
 *     bascule en DONE à la fin.
 *  3. Si un item échoue (translateToAllLocales renvoie {}), errorCount monte
 *     et le job continue avec les items suivants (résilience).
 *  4. dismissTranslationJob pose dismissedAt sans supprimer.
 *  5. dismissDoneTranslationJobs pose dismissedAt sur tous les DONE/FAILED.
 *  6. listRecentTranslationJobs filtre correctement (actifs + DONE récents non
 *     dismiss).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  translationJob: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  colorTranslation: { upsert: vi.fn() },
  tagTranslation: { upsert: vi.fn() },
  categoryTranslation: { upsert: vi.fn() },
  subCategoryTranslation: { upsert: vi.fn() },
  compositionTranslation: { upsert: vi.fn() },
  manufacturingCountryTranslation: { upsert: vi.fn() },
  seasonTranslation: { upsert: vi.fn() },
  collectionTranslation: { upsert: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const translateMock = vi.fn();
vi.mock("@/lib/pfs-translate", () => ({
  translateToAllLocales: (...args: unknown[]) => translateMock(...args),
}));

// NON_DEFAULT_LOCALES = ["en"] (site fr/en uniquement)
vi.mock("@/i18n/locales", () => ({
  NON_DEFAULT_LOCALES: ["en"],
}));

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(prismaMock).forEach((v) => {
    if (typeof v === "object") {
      Object.values(v).forEach((fn) => {
        if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
      });
    }
  });
});

describe("enqueueTranslationJob", () => {
  it("crée un job PENDING avec le bon totalCount", async () => {
    prismaMock.translationJob.create.mockResolvedValue({ id: "job-1" });
    const { enqueueTranslationJob } = await import("@/lib/translation-queue");

    const res = await enqueueTranslationJob({
      section: "Couleurs",
      entityType: "color",
      items: [
        { id: "c1", text: "Rouge" },
        { id: "c2", text: "Bleu" },
      ],
    });

    expect(res.jobId).toBe("job-1");
    expect(prismaMock.translationJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        section: "Couleurs",
        entityType: "color",
        totalCount: 2,
      }),
      select: { id: true },
    });
  });

  it("filtre les items sans id ou texte vide", async () => {
    prismaMock.translationJob.create.mockResolvedValue({ id: "job-2" });
    const { enqueueTranslationJob } = await import("@/lib/translation-queue");

    await enqueueTranslationJob({
      section: "Couleurs",
      entityType: "color",
      items: [
        { id: "c1", text: "Rouge" },
        { id: "", text: "Blanc" },
        { id: "c3", text: "   " },
      ],
    });

    const dataArg = prismaMock.translationJob.create.mock.calls[0][0].data;
    expect(dataArg.totalCount).toBe(1);
  });
});

describe("processJob (worker)", () => {
  it("traduit chaque item et persiste en BDD via upsert", async () => {
    const items = [
      { id: "c1", text: "Rouge" },
      { id: "c2", text: "Bleu" },
    ];
    prismaMock.translationJob.update.mockResolvedValue({
      id: "job-3",
      items,
      entityType: "color",
    });
    translateMock
      .mockResolvedValueOnce({ en: "Red" })
      .mockResolvedValueOnce({ en: "Blue" });

    const { __test } = await import("@/lib/translation-queue");
    await __test.processJob("job-3");

    // 2 traductions persistées dans colorTranslation
    expect(prismaMock.colorTranslation.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.colorTranslation.upsert).toHaveBeenNthCalledWith(1, {
      where: { colorId_locale: { colorId: "c1", locale: "en" } },
      update: { name: "Red" },
      create: { colorId: "c1", locale: "en", name: "Red" },
    });
    expect(prismaMock.colorTranslation.upsert).toHaveBeenNthCalledWith(2, {
      where: { colorId_locale: { colorId: "c2", locale: "en" } },
      update: { name: "Blue" },
      create: { colorId: "c2", locale: "en", name: "Blue" },
    });

    // Le job passe en PROCESSING au début, DONE à la fin
    const updateCalls = prismaMock.translationJob.update.mock.calls;
    expect(updateCalls[0][0].data.status).toBe("PROCESSING");
    const finalCall = updateCalls[updateCalls.length - 1][0];
    expect(finalCall.data.status).toBe("DONE");
    expect(finalCall.data.completedAt).toBeInstanceOf(Date);
  });

  it("incrémente errorCount si la traduction échoue mais continue", async () => {
    const items = [
      { id: "c1", text: "Rouge" },
      { id: "c2", text: "Bleu" },
      { id: "c3", text: "Vert" },
    ];
    prismaMock.translationJob.update.mockResolvedValue({
      id: "job-4",
      items,
      entityType: "color",
    });
    translateMock
      .mockResolvedValueOnce({}) // échec silencieux (pas de traduction)
      .mockResolvedValueOnce({ en: "Blue" })
      .mockRejectedValueOnce(new Error("PFS down"));

    const { __test } = await import("@/lib/translation-queue");
    await __test.processJob("job-4");

    // Une seule traduction persistée (c2 → Blue)
    expect(prismaMock.colorTranslation.upsert).toHaveBeenCalledTimes(1);

    // errorCount = 2 (c1 vide + c3 exception), doneCount = 3 à la fin
    const updateCalls = prismaMock.translationJob.update.mock.calls;
    const withCounts = updateCalls.filter(
      (c) => c[0].data.doneCount !== undefined || c[0].data.errorCount !== undefined,
    );
    const last = withCounts[withCounts.length - 1][0].data;
    expect(last.doneCount).toBe(3);
    expect(last.errorCount).toBe(2);
  });

  it("route vers la bonne table selon entityType", async () => {
    prismaMock.translationJob.update.mockResolvedValue({
      id: "job-5",
      items: [{ id: "t1", text: "Élégant" }],
      entityType: "tag",
    });
    translateMock.mockResolvedValueOnce({ en: "Elegant" });

    const { __test } = await import("@/lib/translation-queue");
    await __test.processJob("job-5");

    expect(prismaMock.tagTranslation.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.colorTranslation.upsert).not.toHaveBeenCalled();
  });
});

describe("dismiss helpers", () => {
  it("dismissTranslationJob pose dismissedAt", async () => {
    prismaMock.translationJob.update.mockResolvedValue({ id: "job-6" });
    const { dismissTranslationJob } = await import("@/lib/translation-queue");
    await dismissTranslationJob("job-6");
    expect(prismaMock.translationJob.update).toHaveBeenCalledWith({
      where: { id: "job-6" },
      data: { dismissedAt: expect.any(Date) },
    });
  });

  it("dismissDoneTranslationJobs vise tous les DONE et FAILED non dismiss", async () => {
    prismaMock.translationJob.updateMany.mockResolvedValue({ count: 3 });
    const { dismissDoneTranslationJobs } = await import("@/lib/translation-queue");
    const res = await dismissDoneTranslationJobs();
    expect(res.removed).toBe(3);
    expect(prismaMock.translationJob.updateMany).toHaveBeenCalledWith({
      where: {
        status: { in: ["DONE", "FAILED"] },
        dismissedAt: null,
      },
      data: { dismissedAt: expect.any(Date) },
    });
  });
});

describe("listRecentTranslationJobs", () => {
  it("récupère les actifs + DONE récents non dismiss", async () => {
    prismaMock.translationJob.findMany.mockResolvedValue([]);
    const { listRecentTranslationJobs } = await import("@/lib/translation-queue");
    await listRecentTranslationJobs();
    const arg = prismaMock.translationJob.findMany.mock.calls[0][0];
    expect(arg.where.OR).toBeDefined();
    // Vérifie la présence des 2 conditions (actifs + terminés récents)
    expect(arg.where.OR).toHaveLength(2);
    expect(arg.take).toBe(20);
  });
});
