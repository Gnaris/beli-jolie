/**
 * Garde-fou anti-doublon : `fairePublishProduct` doit refuser de POST quand
 * `Product.faireProductId` est déjà renseigné. Cas réel observé sur F137 :
 * un fallback "update échoue → publish" avait dupliqué la fiche Faire.
 *
 * Tout chemin qui veut LÉGITIMEMENT recréer un produit Faire DOIT remettre
 * `faireProductId` à null en amont (cf. `lib/faire-refresh.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const prismaMock: any = {
  product: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
};
prismaMock.$transaction = vi.fn(async (fn: any) => {
  if (typeof fn === "function") return fn(prismaMock);
  return Promise.all(fn);
});
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// faireFetch ne doit JAMAIS être appelée dans ce scénario
const faireFetchMock = vi.fn();
vi.mock("@/lib/faire-api", () => ({ faireFetch: faireFetchMock }));

// marketplace-pricing — pas appelé non plus si on s'arrête avant
vi.mock("@/lib/marketplace-pricing", () => ({
  loadMarketplaceMarkupConfigs: vi.fn().mockResolvedValue({
    faireWholesale: { type: "percent", value: 0, rounding: "none" },
    faireRetail: { type: "percent", value: 0, rounding: "none" },
  }),
  applyFaireMarkupWithClamp: vi.fn(),
}));

const { fairePublishProduct } = await import("@/lib/faire-publish");

beforeEach(() => {
  prismaMock.product.findUnique.mockReset();
  prismaMock.product.update.mockReset();
  prismaMock.product.update.mockResolvedValue({});
  faireFetchMock.mockReset();
});

describe("fairePublishProduct — garde-fou anti-doublon", () => {
  it("refuse de POST si le produit a déjà un faireProductId (évite le doublon)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      faireProductId: "p_DEJA_LIE",
    });

    const res = await fairePublishProduct("local-p1");

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toMatch(/déjà lié/);
    expect(res.error).toMatch(/p_DEJA_LIE/);
    expect(res.error).toMatch(/doublon/);
    // Aucun appel HTTP ne doit avoir été tenté
    expect(faireFetchMock).not.toHaveBeenCalled();
  });

  it("laisse passer si faireProductId est null (cas légitime publish initial)", async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({
      faireProductId: null,
    });
    // On ne va pas plus loin pour ce test — on vérifie juste qu'on ne s'arrête
    // pas à la garde. La suite (loadFaireProductFull) renvoie null car le
    // produit n'existe pas dans nos mocks Prisma → fonction continue normalement.
    const res = await fairePublishProduct("local-p1");
    expect(res.success).toBe(false);
    if (res.success) return;
    // L'erreur vient maintenant de "Produit introuvable" (étape suivante),
    // PAS du garde-fou anti-doublon.
    expect(res.error).not.toMatch(/déjà lié/);
  });
});
