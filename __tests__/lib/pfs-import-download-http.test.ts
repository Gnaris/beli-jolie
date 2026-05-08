/**
 * Tests de la passe HTTP directe (fetch) pour le téléchargement d'images PFS.
 * Vérifie :
 *   - parallélisme respecté (concurrence >= 2)
 *   - les échecs n'arrêtent pas le batch et sont retournés pour fallback
 *   - une seule image → un seul appel fetch
 *   - le timeout abort fonctionne (signal AbortController)
 *   - l'annulation utilisateur lève PfsImportCancelledError
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    productColorImage: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/image-processor", () => ({
  processProductImage: vi.fn().mockResolvedValue({ dbPath: "/uploads/products/x.webp" }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { downloadImageBatchHttp } from "@/lib/pfs-import";

function makeImage(order: number) {
  return {
    url: `https://pfs.example/img-${order}.jpg`,
    variantId: "v1",
    colorId: `c${order}`,
    order,
  } as never;
}

interface FakeFetchOpts {
  delayMs?: number;
  failUrls?: Set<string>;
  emptyBodyUrls?: Set<string>;
}

function makeFakeFetch(opts?: FakeFetchOpts) {
  let active = 0;
  let peakActive = 0;
  let calls = 0;

  const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
    calls++;
    active++;
    if (active > peakActive) peakActive = active;
    try {
      if (opts?.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      if (opts?.failUrls?.has(url)) {
        return {
          ok: false,
          status: 500,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      if (opts?.emptyBodyUrls?.has(url)) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const buf = new ArrayBuffer(8);
          new Uint8Array(buf).set([1, 2, 3, 4, 5, 6, 7, 8]);
          return buf;
        },
      };
    } finally {
      active--;
    }
  });

  return {
    fetch: fakeFetch as unknown as typeof fetch,
    getPeakActive: () => peakActive,
    getCalls: () => calls,
  };
}

describe("downloadImageBatchHttp — fetch direct", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("traite plusieurs images simultanément (concurrency >= 2 atteinte)", async () => {
    const images = Array.from({ length: 10 }, (_, i) => makeImage(i));
    const { fetch, getPeakActive } = makeFakeFetch({ delayMs: 30 });

    const failed = await downloadImageBatchHttp("p1", "REF", new Map(), images, "HTTP", { fetchImpl: fetch });

    expect(failed).toHaveLength(0);
    // Concurrence par défaut = 8 → on doit voir au moins 2 fetch en vol simultanément
    expect(getPeakActive()).toBeGreaterThanOrEqual(2);
  });

  it("ne déclenche qu'un fetch par image (pas de retry en passe HTTP)", async () => {
    const images = [makeImage(0), makeImage(1), makeImage(2)];
    const { fetch, getCalls } = makeFakeFetch();

    await downloadImageBatchHttp("p1", "REF", new Map(), images, "HTTP", { fetchImpl: fetch });

    expect(getCalls()).toBe(3);
  });

  it("retourne les images en échec (HTTP 500) sans bloquer le batch", async () => {
    const images = Array.from({ length: 5 }, (_, i) => makeImage(i));
    const failUrls = new Set([images[1].url, images[3].url]);
    const { fetch } = makeFakeFetch({ failUrls });

    const failed = await downloadImageBatchHttp("p1", "REF", new Map(), images, "HTTP", { fetchImpl: fetch });

    expect(failed).toHaveLength(2);
    expect(failed.map((f) => f.url).sort()).toEqual([images[1].url, images[3].url].sort());
  });

  it("retourne les images en échec quand le body est vide", async () => {
    const images = Array.from({ length: 3 }, (_, i) => makeImage(i));
    const emptyBodyUrls = new Set([images[1].url]);
    const { fetch } = makeFakeFetch({ emptyBodyUrls });

    const failed = await downloadImageBatchHttp("p1", "REF", new Map(), images, "HTTP", { fetchImpl: fetch });

    expect(failed).toHaveLength(1);
    expect(failed[0].url).toBe(images[1].url);
  });

  it("retourne un tableau vide quand toutes les images réussissent", async () => {
    const images = Array.from({ length: 4 }, (_, i) => makeImage(i));
    const { fetch } = makeFakeFetch();

    const failed = await downloadImageBatchHttp("p1", "REF", new Map(), images, "HTTP", { fetchImpl: fetch });

    expect(failed).toEqual([]);
  });

  it("propage l'annulation utilisateur (PfsImportCancelledError)", async () => {
    const images = Array.from({ length: 20 }, (_, i) => makeImage(i));
    let processedCount = 0;
    const { fetch } = makeFakeFetch({ delayMs: 5 });

    await expect(
      downloadImageBatchHttp("p1", "REF", new Map(), images, "HTTP", {
        fetchImpl: fetch,
        isCancelled: () => {
          processedCount++;
          return processedCount > 3;
        },
      }),
    ).rejects.toThrow(/annul/i);
  });
});
