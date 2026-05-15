/**
 * Tests pour le garde-fou « refresh récent » :
 *  - updateRefreshWarning (server action) : gating admin + validation jours
 *  - getRecentlyRefreshedProducts (server action) : filtrage selon config
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetServerSession = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  siteConfig: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
  product: {
    findMany: vi.fn(),
  },
}));
const mockRevalidate = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T>(fn: T) => fn,
}));
const mockHealth = vi.hoisted(() => ({ clearAutoMaintenance: vi.fn() }));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => mockRevalidate);
vi.mock("@/lib/health", () => mockHealth);
// Évite de charger les modules PFS / Ankorstore lors de l'import de marketplace-refresh
vi.mock("@/lib/pfs-refresh", () => ({ pfsRefreshProduct: vi.fn() }));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { updateRefreshWarning } from "@/app/actions/admin/site-config";
import { getRecentlyRefreshedProducts } from "@/app/actions/admin/marketplace-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.siteConfig.upsert.mockResolvedValue({});
});

describe("updateRefreshWarning", () => {
  it("refuse un visiteur non connecté", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const result = await updateRefreshWarning(true, 7);
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("refuse un client connecté (non admin)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "CLIENT" } });
    const result = await updateRefreshWarning(true, 7);
    expect(result.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("rejette un nombre de jours hors bornes", async () => {
    mockGetServerSession.mockResolvedValue({ user: { role: "ADMIN" } });
    const r1 = await updateRefreshWarning(true, 0);
    expect(r1.success).toBe(false);
    const r2 = await updateRefreshWarning(true, 366);
    expect(r2.success).toBe(false);
    const r3 = await updateRefreshWarning(true, NaN);
    expect(r3.success).toBe(false);
    expect(mockPrisma.siteConfig.upsert).not.toHaveBeenCalled();
  });

  it("upsert les deux clés SiteConfig pour un admin et tronque les décimales", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateRefreshWarning(true, 7.9);
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: "refresh_warning_enabled" },
      update: { value: "true" },
      create: { key: "refresh_warning_enabled", value: "true" },
    });
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: "refresh_warning_days" },
      update: { value: "7" },
      create: { key: "refresh_warning_days", value: "7" },
    });
    expect(mockRevalidate.revalidateTag).toHaveBeenCalledWith("site-config", "default");
  });

  it("écrit 'false' quand on désactive", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    const result = await updateRefreshWarning(false, 14);
    expect(result.success).toBe(true);
    expect(mockPrisma.siteConfig.upsert).toHaveBeenCalledWith({
      where: { key: "refresh_warning_enabled" },
      update: { value: "false" },
      create: { key: "refresh_warning_enabled", value: "false" },
    });
  });
});

describe("getRecentlyRefreshedProducts", () => {
  it("refuse un non-admin", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    await expect(getRecentlyRefreshedProducts(["p1"])).rejects.toThrow();
  });

  it("retourne enabled=false et items vide quand le garde-fou est désactivé", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "refresh_warning_enabled") return Promise.resolve({ value: "false" });
      if (where.key === "refresh_warning_days") return Promise.resolve({ value: "7" });
      return Promise.resolve(null);
    });
    const result = await getRecentlyRefreshedProducts(["p1", "p2"]);
    expect(result.enabled).toBe(false);
    expect(result.items).toEqual([]);
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });

  it("retourne items vide quand aucun produit demandé", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "refresh_warning_enabled") return Promise.resolve({ value: "true" });
      if (where.key === "refresh_warning_days") return Promise.resolve({ value: "7" });
      return Promise.resolve(null);
    });
    const result = await getRecentlyRefreshedProducts([]);
    expect(result.enabled).toBe(true);
    expect(result.items).toEqual([]);
    expect(mockPrisma.product.findMany).not.toHaveBeenCalled();
  });

  it("filtre les produits rafraîchis dans la fenêtre et calcule daysAgo", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "refresh_warning_enabled") return Promise.resolve({ value: "true" });
      if (where.key === "refresh_warning_days") return Promise.resolve({ value: "7" });
      return Promise.resolve(null);
    });
    const now = Date.now();
    const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000);
    mockPrisma.product.findMany.mockResolvedValueOnce([
      { id: "p1", reference: "REF1", name: "Produit 1", lastRefreshedAt: oneDayAgo },
      { id: "p2", reference: "REF2", name: "Produit 2", lastRefreshedAt: fourDaysAgo },
    ]);

    const result = await getRecentlyRefreshedProducts(["p1", "p2", "p3"]);
    expect(result.enabled).toBe(true);
    expect(result.thresholdDays).toBe(7);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      productId: "p1",
      reference: "REF1",
      productName: "Produit 1",
      daysAgo: 1,
    });
    expect(result.items[1]).toMatchObject({
      productId: "p2",
      daysAgo: 4,
    });
    // Vérifie le filtre Prisma : cutoff strictement < lastRefreshedAt
    const findManyCall = mockPrisma.product.findMany.mock.calls[0]![0];
    expect(findManyCall.where.id).toEqual({ in: ["p1", "p2", "p3"] });
    expect(findManyCall.where.lastRefreshedAt.gt).toBeInstanceOf(Date);
  });

  it("utilise 7 jours par défaut si la clé days est manquante ou invalide", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { role: "ADMIN" } });
    mockPrisma.siteConfig.findUnique.mockImplementation(({ where }: { where: { key: string } }) => {
      if (where.key === "refresh_warning_enabled") return Promise.resolve({ value: "true" });
      if (where.key === "refresh_warning_days") return Promise.resolve(null);
      return Promise.resolve(null);
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([]);
    const result = await getRecentlyRefreshedProducts(["p1"]);
    expect(result.thresholdDays).toBe(7);
    expect(result.items).toEqual([]);
  });
});
