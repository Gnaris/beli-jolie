/**
 * Régression pour le bug rapporté par la cliente 2026-10-26 :
 *
 * Bulk « Tout synchroniser » sur /admin/produits ouvre le widget marketplace
 * et affiche le toast « X envois lancés », mais aucune carte n'apparaît et
 * aucun badge ne bascule : 20 produits OK, 200 produits KO.
 *
 * Cause : POST /api/admin/marketplace-queue envoyé avec `keepalive: true` est
 * capé à 64 kB par le navigateur. 200 produits × 2-3 marketplaces × ~400 o
 * d'items JSON dépasse la limite — le fetch est rejeté silencieusement et le
 * serveur ne reçoit rien.
 *
 * Fix : enqueue() découpe le payload en lots de 50 et fait N POST séquentiels.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  MarketplaceRefreshProvider,
  useMarketplaceRefreshQueue,
  type MarketplaceRefreshEnqueueInput,
} from "@/components/admin/products/MarketplaceRefreshContext";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(MarketplaceRefreshProvider, null, children);
}

function makeInputs(n: number): MarketplaceRefreshEnqueueInput[] {
  return Array.from({ length: n }, (_, i) => ({
    productId: `p${i}`,
    reference: `REF${i}`,
    productName: `Produit ${i}`,
    firstImage: null,
    options: { local: false, pfs: true, ankorstore: false, efashion: false, faire: false },
    mode: "resync" as const,
    marketplace: "pfs" as const,
  }));
}

// Compte les appels POST sur /api/admin/marketplace-queue (ignore les GET du
// polling initial et les /dismiss / /stop / /clear).
function countEnqueuePosts(fetchMock: ReturnType<typeof vi.fn>): number {
  let count = 0;
  for (const call of fetchMock.mock.calls) {
    const [url, init] = call as [string, RequestInit | undefined];
    if (url !== "/api/admin/marketplace-queue") continue;
    if (init?.method !== "POST") continue;
    count += 1;
  }
  return count;
}

function postedItemsPerBatch(fetchMock: ReturnType<typeof vi.fn>): number[] {
  const sizes: number[] = [];
  for (const call of fetchMock.mock.calls) {
    const [url, init] = call as [string, RequestInit | undefined];
    if (url !== "/api/admin/marketplace-queue") continue;
    if (init?.method !== "POST") continue;
    const body = JSON.parse(init.body as string) as { items: unknown[] };
    sizes.push(body.items.length);
  }
  return sizes;
}

describe("MarketplaceRefreshContext.enqueue() — batching 64 kB", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], created: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("envoie un seul POST pour un petit lot (< 50 items)", async () => {
    const { result } = renderHook(() => useMarketplaceRefreshQueue(), { wrapper });

    act(() => {
      result.current.enqueue(makeInputs(20));
    });

    await waitFor(() => {
      expect(countEnqueuePosts(fetchMock)).toBe(1);
    });
    expect(postedItemsPerBatch(fetchMock)).toEqual([20]);
  });

  it("découpe un gros lot (> 50 items) en plusieurs POST séquentiels", async () => {
    const { result } = renderHook(() => useMarketplaceRefreshQueue(), { wrapper });

    act(() => {
      result.current.enqueue(makeInputs(120));
    });

    // 120 items → 3 lots : 50 + 50 + 20
    await waitFor(() => {
      expect(countEnqueuePosts(fetchMock)).toBe(3);
    });
    expect(postedItemsPerBatch(fetchMock)).toEqual([50, 50, 20]);
  });

  it("découpe exactement en lots de 50 quand le total est un multiple", async () => {
    const { result } = renderHook(() => useMarketplaceRefreshQueue(), { wrapper });

    act(() => {
      result.current.enqueue(makeInputs(100));
    });

    await waitFor(() => {
      expect(countEnqueuePosts(fetchMock)).toBe(2);
    });
    expect(postedItemsPerBatch(fetchMock)).toEqual([50, 50]);
  });

  it("chaque POST reste sous la limite 64 kB du fetch keepalive", async () => {
    const { result } = renderHook(() => useMarketplaceRefreshQueue(), { wrapper });

    act(() => {
      result.current.enqueue(makeInputs(200));
    });

    await waitFor(() => {
      expect(countEnqueuePosts(fetchMock)).toBe(4);
    });

    const LIMIT_BYTES = 64 * 1024;
    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [string, RequestInit | undefined];
      if (url !== "/api/admin/marketplace-queue") continue;
      if (init?.method !== "POST") continue;
      const size = new TextEncoder().encode(init.body as string).byteLength;
      expect(size).toBeLessThan(LIMIT_BYTES);
    }
  });

  it("ne fait aucun POST si inputs est vide", async () => {
    const { result } = renderHook(() => useMarketplaceRefreshQueue(), { wrapper });

    act(() => {
      result.current.enqueue([]);
    });

    // Laisse quelques microtasks s'écouler pour détecter un POST éventuel.
    await new Promise((r) => setTimeout(r, 20));
    expect(countEnqueuePosts(fetchMock)).toBe(0);
  });
});
