/**
 * syncRecentFaireOrders — polling incrémental.
 *
 * Régression 2026-08-08 (bug Issyma) : le worker appelait
 * `faireListOrders(1, 50)` sans filtre `updated_at_min`. Comme Faire trie par
 * `updated_at` ASC (contrairement à PFS/Ankor), la page 1 remontait 50 vieilles
 * commandes stables et les nouvelles étaient noyées derrière — 38 commandes
 * ratées en 10 jours sur Issyma.
 *
 * Ces tests verrouillent le comportement corrigé :
 *  - `updated_at_min` est toujours passé (dérivé de `faire_orders_last_synced_at`)
 *  - Buffer de 15 min appliqué (marge race entre 2 ticks)
 *  - Fallback 24 h si jamais synced
 *  - Pagination : itère tant que la page renvoie 50 commandes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const prismaMock: any = {
  siteConfig: { findFirst: vi.fn() },
  faireOrder: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const faireListOrdersMock = vi.fn();
vi.mock("@/lib/faire-orders-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/faire-orders-api")>(
    "@/lib/faire-orders-api",
  );
  return { ...actual, faireListOrders: faireListOrdersMock };
});

// Note : on ne mock pas `upsertFaireOrderFromResource` — l'appel intra-module
// n'est pas interceptable par `vi.mock`. On vérifie uniquement le flux d'appels
// à `faireListOrders` (updated_at_min + pagination), pas la couche upsert.
// Pour forcer les `if (!existing || …)` à ne PAS entrer dans le upsert, on
// fournit des `existing` matchant en base — comme ça la boucle ne tape jamais
// la vraie fonction et le test reste étanche.
const { syncRecentFaireOrders } = await import("@/lib/faire-orders-sync");

beforeEach(() => {
  prismaMock.siteConfig.findFirst.mockReset();
  prismaMock.faireOrder.findMany.mockReset();
  // Par défaut, on renvoie tous les orders comme déjà en base avec updated_at
  // futur → skip du upsert (pas d'appel réel).
  prismaMock.faireOrder.findMany.mockImplementation(async ({ where }: any) => {
    const ids: string[] = where?.faireOrderId?.in ?? [];
    return ids.map((id) => ({
      faireOrderId: id,
      updatedAtFaire: new Date("2099-01-01"),
      statusRaw: "NEW",
    }));
  });
  faireListOrdersMock.mockReset();
});

describe("syncRecentFaireOrders", () => {
  it("passe updated_at_min dérivé de faire_orders_last_synced_at avec buffer 15 min", async () => {
    // lastSyncedAt = 2026-08-08 12:00:00 UTC
    const lastSyncedAt = new Date("2026-08-08T12:00:00Z").getTime();
    prismaMock.siteConfig.findFirst.mockResolvedValue({ value: String(lastSyncedAt) });
    faireListOrdersMock.mockResolvedValue({ page: 1, limit: 50, orders: [] });

    await syncRecentFaireOrders("tenant-1");

    expect(faireListOrdersMock).toHaveBeenCalledTimes(1);
    const [page, limit, updatedAtMin] = faireListOrdersMock.mock.calls[0];
    expect(page).toBe(1);
    expect(limit).toBe(50);
    // 12:00 - 15 min = 11:45
    expect(updatedAtMin).toBe("2026-08-08T11:45:00.000Z");
  });

  it("fallback à 24h en arrière si faire_orders_last_synced_at absent", async () => {
    prismaMock.siteConfig.findFirst.mockResolvedValue(null);
    faireListOrdersMock.mockResolvedValue({ page: 1, limit: 50, orders: [] });

    const before = Date.now();
    await syncRecentFaireOrders("tenant-1");
    const after = Date.now();

    const [, , updatedAtMin] = faireListOrdersMock.mock.calls[0];
    const passedMs = new Date(updatedAtMin as string).getTime();
    // Doit être entre now-24h-15min et now-24h+15min (buffer)
    const target = (Date.now() - 24 * 60 * 60_000) - 15 * 60_000;
    expect(passedMs).toBeGreaterThanOrEqual(before - 24 * 60 * 60_000 - 15 * 60_000 - 100);
    expect(passedMs).toBeLessThanOrEqual(after - 24 * 60 * 60_000 - 15 * 60_000 + 100);
  });

  it("pagine tant que la page renvoie 50 commandes puis s'arrête sur < 50", async () => {
    prismaMock.siteConfig.findFirst.mockResolvedValue({ value: String(Date.now()) });

    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      id: `bo_p${i}`,
      state: "NEW",
      updated_at: "2026-08-08T10:00:00Z",
    }));
    const partialPage = Array.from({ length: 12 }, (_, i) => ({
      id: `bo_partial_${i}`,
      state: "NEW",
      updated_at: "2026-08-08T10:00:00Z",
    }));

    faireListOrdersMock
      .mockResolvedValueOnce({ page: 1, limit: 50, orders: fullPage })
      .mockResolvedValueOnce({ page: 2, limit: 50, orders: fullPage })
      .mockResolvedValueOnce({ page: 3, limit: 50, orders: partialPage });

    const res = await syncRecentFaireOrders("tenant-1");

    expect(faireListOrdersMock).toHaveBeenCalledTimes(3);
    expect(faireListOrdersMock.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(res.scanned).toBe(50 + 50 + 12);
  });

  it("s'arrête après 20 pages même si Faire renvoie toujours 50 (safety cap)", async () => {
    prismaMock.siteConfig.findFirst.mockResolvedValue({ value: String(Date.now()) });
    const fullPage = Array.from({ length: 50 }, (_, i) => ({
      id: `bo_${Math.random()}`,
      state: "NEW",
      updated_at: "2026-08-08T10:00:00Z",
    }));
    faireListOrdersMock.mockResolvedValue({ page: 1, limit: 50, orders: fullPage });

    await syncRecentFaireOrders("tenant-1");

    expect(faireListOrdersMock).toHaveBeenCalledTimes(20);
  });
});
