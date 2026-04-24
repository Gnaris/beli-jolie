import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Le processeur d'import PFS doit diffuser via SSE la liste des produits
 * déjà traités + la concurrence — sans ça l'UI ne sait pas afficher
 * « Prêt » sur les produits terminés en parallèle.
 */

const {
  mockImportJobFindUnique,
  mockImportJobUpdate,
  approveAndImportPfsProductSpy,
  emitProductEventSpy,
} = vi.hoisted(() => ({
  mockImportJobFindUnique: vi.fn(),
  mockImportJobUpdate: vi.fn(),
  approveAndImportPfsProductSpy: vi.fn(),
  emitProductEventSpy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    importJob: {
      findUnique: mockImportJobFindUnique,
      update: mockImportJobUpdate,
    },
  },
}));

vi.mock("@/lib/pfs-import", () => ({
  approveAndImportPfsProduct: approveAndImportPfsProductSpy,
  PfsImportCancelledError: class PfsImportCancelledError extends Error {},
}));

vi.mock("@/lib/product-events", () => ({
  emitProductEvent: emitProductEventSpy,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processPfsImport } from "@/lib/pfs-import-processor";

describe("processPfsImport — diffusion SSE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportJobFindUnique.mockImplementation(async () => ({
      id: "job-1",
      status: "PROCESSING",
      resultDetails: {
        items: [
          { pfsId: "a", reference: "REF-A", name: "Produit A" },
          { pfsId: "b", reference: "REF-B", name: "Produit B" },
          { pfsId: "c", reference: "REF-C", name: "Produit C" },
        ],
      },
    }));
    mockImportJobUpdate.mockResolvedValue({});
    approveAndImportPfsProductSpy.mockImplementation(async (pfsId: string) => ({
      productId: `prod-${pfsId}`,
      reference: `REF-${pfsId.toUpperCase()}`,
      name: `Produit ${pfsId}`,
      warnings: [],
    }));
  });

  it("inclut la liste des résultats et la concurrence dans chaque événement SSE", async () => {
    await processPfsImport("job-1");

    const events = emitProductEventSpy.mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "IMPORT_PROGRESS");

    expect(events.length).toBeGreaterThanOrEqual(2);
    // Le premier event (avant toute importation) porte concurrency et results=[]
    expect(events[0].importProgress.concurrency).toBeGreaterThan(1);
    expect(events[0].importProgress.results).toEqual([]);

    // Le dernier event contient tous les résultats
    const last = events[events.length - 1].importProgress;
    expect(last.results).toHaveLength(3);
    expect(last.results.every((r: { status: string }) => r.status === "ok")).toBe(true);
    expect(last.concurrency).toBeGreaterThan(1);
  });

  it("propage le productId et le pfsId dans les résultats SSE pour le badge « Voir »", async () => {
    await processPfsImport("job-1");

    const events = emitProductEventSpy.mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "IMPORT_PROGRESS");

    const last = events[events.length - 1].importProgress;
    const byId = new Map(last.results.map((r: { pfsId: string }) => [r.pfsId, r]));
    expect((byId.get("a") as { productId: string }).productId).toBe("prod-a");
    expect((byId.get("b") as { productId: string }).productId).toBe("prod-b");
  });

  it("ne laisse PAS fuir les champs reference / name dans les résultats SSE (payload compact)", async () => {
    await processPfsImport("job-1");

    const events = emitProductEventSpy.mock.calls
      .map(([e]) => e)
      .filter((e) => e.type === "IMPORT_PROGRESS");

    const last = events[events.length - 1].importProgress;
    for (const r of last.results) {
      expect(r).not.toHaveProperty("reference");
      expect(r).not.toHaveProperty("name");
    }
  });
});
