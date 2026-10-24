/**
 * Tests pour toggleTrending.
 *
 * Comportement attendu :
 * - Passage OFF→ON : pose `isTrending=true` + `trendingSince=now()`.
 *   Donc retirer puis remettre la tendance = date rafraîchie = produit remonte
 *   en tête du carousel « Les tendances du moment » (home Beli & Jolie).
 * - Passage ON→OFF : pose `isTrending=false` + `trendingSince=null`.
 * - Pas d'opération si l'état cible est déjà celui en base.
 * - Aucun drapeau marketplace « syncRequired » : la tendance est 100 % locale.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProductFindUnique = vi.fn();
const mockProductUpdate = vi.fn().mockResolvedValue({});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...a: unknown[]) => mockProductFindUnique(...a),
      update: (...a: unknown[]) => mockProductUpdate(...a),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/translate", () => ({
  invalidateProductTranslations: vi.fn(),
  translateTextStrict: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({}));
vi.mock("@/lib/product-events", () => ({ emitProductEvent: vi.fn() }));
vi.mock("@/lib/auto-translate", () => ({
  autoTranslateProduct: vi.fn(),
  autoTranslateTag: vi.fn(),
}));
vi.mock("@/lib/sku", () => ({ generateSku: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  deleteFiles: vi.fn(),
  keyFromDbPath: vi.fn((s: string) => s),
  productImageDir: vi.fn(),
  renameProductFolder: vi.fn(),
  deleteDirectory: vi.fn(),
}));
vi.mock("@/lib/image-utils", () => ({
  getImagePaths: vi.fn(() => ({ large: "l", medium: "m", thumb: "t" })),
}));
vi.mock("@/lib/pfs-api-write", () => ({
  pfsGetGenders: vi.fn().mockResolvedValue([]),
  pfsGetFamilies: vi.fn().mockResolvedValue([]),
  pfsGetCategories: vi.fn().mockResolvedValue([]),
  pfsGetColors: vi.fn().mockResolvedValue([]),
  pfsGetCompositions: vi.fn().mockResolvedValue([]),
  pfsGetCountries: vi.fn().mockResolvedValue([]),
  pfsGetSizes: vi.fn().mockResolvedValue([]),
  pfsGetCollections: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/pfs-api", () => ({ pfsCheckReference: vi.fn() }));
vi.mock("@/lib/ankorstore-api-write", () => ({
  ankorstoreDeleteProduct: vi.fn(),
}));

import { toggleTrending } from "@/app/actions/admin/products";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toggleTrending", () => {
  it("passage OFF→ON : pose isTrending=true et trendingSince à la date du jour", async () => {
    mockProductFindUnique.mockResolvedValue({ isTrending: false });

    const result = await toggleTrending("prod-1", true);

    expect(result.success).toBe(true);
    const call = mockProductUpdate.mock.calls[0][0];
    expect(call.where).toEqual({ id: "prod-1" });
    expect(call.data.isTrending).toBe(true);
    expect(call.data.trendingSince).toBeInstanceOf(Date);
    // La date doit être très récente (< 5s)
    expect(Date.now() - (call.data.trendingSince as Date).getTime()).toBeLessThan(5000);
  });

  it("passage ON→OFF : pose isTrending=false et vide trendingSince", async () => {
    mockProductFindUnique.mockResolvedValue({ isTrending: true });

    const result = await toggleTrending("prod-2", false);

    expect(result.success).toBe(true);
    const call = mockProductUpdate.mock.calls[0][0];
    expect(call.data.isTrending).toBe(false);
    expect(call.data.trendingSince).toBeNull();
  });

  it("retirer puis remettre rafraîchit trendingSince (produit remonte en tête)", async () => {
    // 1ère mise en tendance
    mockProductFindUnique.mockResolvedValueOnce({ isTrending: false });
    await toggleTrending("prod-3", true);
    const firstDate = mockProductUpdate.mock.calls[0][0].data.trendingSince as Date;

    // Attendre un peu puis retirer puis remettre
    await new Promise((r) => setTimeout(r, 10));
    mockProductFindUnique.mockResolvedValueOnce({ isTrending: true });
    await toggleTrending("prod-3", false);
    await new Promise((r) => setTimeout(r, 10));
    mockProductFindUnique.mockResolvedValueOnce({ isTrending: false });
    await toggleTrending("prod-3", true);

    const lastDate = mockProductUpdate.mock.calls[2][0].data.trendingSince as Date;
    expect(lastDate.getTime()).toBeGreaterThan(firstDate.getTime());
  });

  it("no-op si l'état est déjà celui demandé (pas d'update)", async () => {
    mockProductFindUnique.mockResolvedValue({ isTrending: true });

    const result = await toggleTrending("prod-4", true);

    expect(result.success).toBe(true);
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it("produit introuvable → échec propre, pas d'update", async () => {
    mockProductFindUnique.mockResolvedValue(null);

    const result = await toggleTrending("inexistant", true);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });
});
