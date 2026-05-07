import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/pfs-api", () => ({
  pfsListProducts: vi.fn(),
}));

import { pfsListProducts } from "@/lib/pfs-api";
import {
  getCachedPfsProductById,
  invalidatePfsListCache,
  __resetPfsListCacheForTests,
} from "@/lib/pfs-list-cache";

const listMock = pfsListProducts as ReturnType<typeof vi.fn>;

function makeProduct(id: string) {
  return { id, reference: `REF-${id}` } as never;
}

function mockPages(pages: { id: string }[][]) {
  listMock.mockReset();
  pages.forEach((data, idx) => {
    listMock.mockResolvedValueOnce({
      data: data.map((p) => makeProduct(p.id)),
      meta: { current_page: idx + 1, last_page: pages.length, from: 0, per_page: 100, total: pages.flat().length },
    });
  });
}

describe("pfs-list-cache", () => {
  beforeEach(() => {
    __resetPfsListCacheForTests();
    listMock.mockReset();
  });

  it("construit l'index complet au premier appel et le réutilise ensuite", async () => {
    mockPages([
      [{ id: "A" }, { id: "B" }],
      [{ id: "C" }, { id: "D" }],
    ]);

    const a = await getCachedPfsProductById("A");
    expect(a?.id).toBe("A");
    expect(listMock).toHaveBeenCalledTimes(2);

    const d = await getCachedPfsProductById("D");
    expect(d?.id).toBe("D");
    // Aucun appel HTTP supplémentaire — tout vient du cache
    expect(listMock).toHaveBeenCalledTimes(2);

    const c = await getCachedPfsProductById("C");
    expect(c?.id).toBe("C");
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("retourne undefined pour un ID inconnu après index complet", async () => {
    mockPages([[{ id: "A" }]]);
    const missing = await getCachedPfsProductById("ZZZ");
    expect(missing).toBeUndefined();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("invalidate() force un nouveau chargement complet", async () => {
    mockPages([[{ id: "A" }]]);
    await getCachedPfsProductById("A");
    expect(listMock).toHaveBeenCalledTimes(1);

    invalidatePfsListCache();
    mockPages([[{ id: "A" }, { id: "B" }]]);

    const b = await getCachedPfsProductById("B");
    expect(b?.id).toBe("B");
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("dedupe les appels concurrents : un seul build pour N requêtes simultanées", async () => {
    let resolveFirst: (() => void) | null = null;
    const firstCall = new Promise<void>((resolve) => { resolveFirst = resolve; });
    listMock.mockImplementationOnce(async () => {
      await firstCall;
      return {
        data: [makeProduct("A"), makeProduct("B")],
        meta: { current_page: 1, last_page: 1, from: 0, per_page: 100, total: 2 },
      };
    });

    const p1 = getCachedPfsProductById("A");
    const p2 = getCachedPfsProductById("B");
    const p3 = getCachedPfsProductById("A");

    resolveFirst!();
    const [a, b, a2] = await Promise.all([p1, p2, p3]);

    expect(a?.id).toBe("A");
    expect(b?.id).toBe("B");
    expect(a2?.id).toBe("A");
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
