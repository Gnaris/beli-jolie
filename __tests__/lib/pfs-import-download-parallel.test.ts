/**
 * Tests de parallélisation du téléchargement d'images PFS.
 * On simule un BrowserContext Playwright pour vérifier :
 *   - les images sont téléchargées en parallèle (concurrency limit respectée)
 *   - une seule page est créée par worker (pas par image)
 *   - les échecs n'arrêtent pas le batch et sont retournés
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

import { downloadImageBatch } from "@/lib/pfs-import";

interface FakePage {
  id: number;
  closed: boolean;
  goto: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeImage(order: number) {
  return {
    url: `https://pfs.example/img-${order}.jpg`,
    variantId: "v1",
    colorId: `c${order}`,
    order,
  } as never;
}

function makeContext(opts?: {
  delayMs?: number;
  failUrls?: Set<string>;
  onPageOpen?: () => void;
}) {
  const pages: FakePage[] = [];
  let nextId = 1;
  let active = 0;
  let peakActive = 0;

  const newPage = vi.fn().mockImplementation(async () => {
    opts?.onPageOpen?.();
    const page: FakePage = {
      id: nextId++,
      closed: false,
      goto: vi.fn().mockImplementation(async (url: string) => {
        active++;
        if (active > peakActive) peakActive = active;
        try {
          if (opts?.delayMs) {
            await new Promise((r) => setTimeout(r, opts.delayMs));
          }
          if (opts?.failUrls?.has(url)) {
            return { ok: () => false, status: () => 500, body: async () => Buffer.alloc(0) };
          }
          return {
            ok: () => true,
            status: () => 200,
            body: async () => Buffer.from("fake-image"),
          };
        } finally {
          active--;
        }
      }),
      close: vi.fn().mockImplementation(async () => {
        page.closed = true;
      }),
    };
    pages.push(page);
    return page;
  });

  return {
    context: { newPage } as unknown as import("playwright").BrowserContext,
    pages,
    getPeakActive: () => peakActive,
  };
}

describe("downloadImageBatch — parallélisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("traite plusieurs images simultanément (concurrency >= 2 atteint)", async () => {
    const images = Array.from({ length: 6 }, (_, i) => makeImage(i));
    const { context, getPeakActive } = makeContext({ delayMs: 30 });

    const failed = await downloadImageBatch(context, "p1", images, "A");

    expect(failed).toHaveLength(0);
    expect(getPeakActive()).toBeGreaterThanOrEqual(2);
  });

  it("crée au plus IMAGE_DOWNLOAD_CONCURRENCY pages, pas une par image", async () => {
    const images = Array.from({ length: 10 }, (_, i) => makeImage(i));
    const { context, pages } = makeContext({ delayMs: 5 });

    await downloadImageBatch(context, "p1", images, "A");

    // 10 images, mais une page par worker — donc ≤ 3 pages créées
    expect(pages.length).toBeLessThanOrEqual(3);
    // Toutes les pages créées sont fermées proprement
    for (const p of pages) expect(p.closed).toBe(true);
  });

  it("crée 1 seule page si une seule image", async () => {
    const images = [makeImage(0)];
    const { context, pages } = makeContext();

    const failed = await downloadImageBatch(context, "p1", images, "A");

    expect(failed).toHaveLength(0);
    expect(pages).toHaveLength(1);
    expect(pages[0].closed).toBe(true);
  });

  it("retourne les images en échec sans bloquer le batch", async () => {
    const images = Array.from({ length: 5 }, (_, i) => makeImage(i));
    const failUrls = new Set([images[1].url, images[3].url]);
    const { context } = makeContext({ failUrls });

    const failed = await downloadImageBatch(context, "p1", images, "A");

    expect(failed).toHaveLength(2);
    expect(failed.map((f) => f.url).sort()).toEqual([images[1].url, images[3].url].sort());
  });

  it("propage l'annulation et ne traite plus de nouvelles images", async () => {
    const images = Array.from({ length: 20 }, (_, i) => makeImage(i));
    let processedCount = 0;
    const { context } = makeContext({
      delayMs: 5,
      onPageOpen: () => { /* noop */ },
    });

    // On annule après quelques traitements (compteur synchrone côté test)
    await expect(
      downloadImageBatch(context, "p1", images, "A", {
        isCancelled: () => {
          processedCount++;
          return processedCount > 5;
        },
      }),
    ).rejects.toThrow(/annul/i);
  });
});
