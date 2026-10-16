/**
 * Tests des actions admin pour la liste des transporteurs Easy-Express exclus :
 *   - fetchEasyExpressAvailableCarriers : dédoublonne + trie la liste live
 *   - updateEasyExpressExcludedCarriers : normalise, dédoublonne, vide = supprime
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSiteConfigDeleteMany = vi.fn();
const mockSetSiteConfig = vi.fn().mockResolvedValue(undefined);
const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();
const mockFetchEasyExpressRates = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteConfig: {
      findFirst: vi.fn(),
      deleteMany: (...a: unknown[]) => mockSiteConfigDeleteMany(...a),
    },
    product: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { role: "ADMIN" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a),
  revalidateTag: (...a: unknown[]) => mockRevalidateTag(...a),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/health", () => ({ clearAutoMaintenance: vi.fn() }));
vi.mock("@/lib/product-display", () => ({}));
vi.mock("@/lib/product-display-shared", () => ({ parseDisplayConfig: vi.fn() }));
vi.mock("@/lib/encryption", () => ({ encryptIfSensitive: vi.fn((_, v) => v) }));
vi.mock("@/lib/marketplace-pricing", () => ({}));
vi.mock("@/lib/storage", () => ({ deleteFile: vi.fn(), keyFromDbPath: vi.fn() }));
vi.mock("@/lib/site-config-write", () => ({
  setSiteConfig: (...a: unknown[]) => mockSetSiteConfig(...a),
  unsetSiteConfig: vi.fn(),
}));
vi.mock("@/lib/easy-express", () => ({
  fetchEasyExpressRates: (...a: unknown[]) => mockFetchEasyExpressRates(...a),
}));

import {
  fetchEasyExpressAvailableCarriers,
  updateEasyExpressExcludedCarriers,
} from "@/app/actions/admin/site-config";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchEasyExpressAvailableCarriers", () => {
  it("retourne la liste triée alphabétiquement et sans doublon", async () => {
    mockFetchEasyExpressRates.mockResolvedValue({
      success: true,
      transactionId: "tx",
      carriers: [
        { carrierId: "a", name: "Mondial Relay", price: 6, delay: "4j", logo: "mr.png" },
        { carrierId: "b", name: "Colissimo",     price: 8, delay: "48h", logo: "co.png" },
        // Doublon : même nom mais tarif différent (variante) → fusionné.
        { carrierId: "c", name: "Colissimo",     price: 9, delay: "48h", logo: "co.png" },
        { carrierId: "d", name: "Chronopost",    price: 10, delay: "24h", logo: "ch.png" },
      ],
    });

    const res = await fetchEasyExpressAvailableCarriers();

    expect(res.success).toBe(true);
    expect(res.carriers?.map((c) => c.name)).toEqual([
      "Chronopost",
      "Colissimo",
      "Mondial Relay",
    ]);
  });

  it("renvoie l'erreur de la cotation Easy-Express", async () => {
    mockFetchEasyExpressRates.mockResolvedValue({
      success: false,
      error: "Clé API manquante.",
    });

    const res = await fetchEasyExpressAvailableCarriers();

    expect(res.success).toBe(false);
    expect(res.error).toContain("Clé API");
  });

  it("rejette les non-admins", async () => {
    const nextAuth = await import("next-auth");
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce({
      user: { role: "CLIENT" },
    } as never);

    const res = await fetchEasyExpressAvailableCarriers();

    expect(res.success).toBe(false);
    expect(mockFetchEasyExpressRates).not.toHaveBeenCalled();
  });
});

describe("updateEasyExpressExcludedCarriers", () => {
  it("enregistre la liste nettoyée (trim + dédoublonnage) en JSON", async () => {
    const res = await updateEasyExpressExcludedCarriers([
      "  Mondial Relay  ",
      "Chronopost",
      "Chronopost", // doublon exact
      "   ",       // vide
    ]);

    expect(res.success).toBe(true);
    expect(mockSetSiteConfig).toHaveBeenCalledWith(
      "easy_express_excluded_carriers",
      JSON.stringify(["Mondial Relay", "Chronopost"]),
    );
    expect(mockSiteConfigDeleteMany).not.toHaveBeenCalled();
  });

  it("supprime la clé quand la liste est vide", async () => {
    const res = await updateEasyExpressExcludedCarriers([]);

    expect(res.success).toBe(true);
    expect(mockSiteConfigDeleteMany).toHaveBeenCalledWith({
      where: { key: "easy_express_excluded_carriers" },
    });
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });

  it("supprime la clé si uniquement des chaînes vides sont passées", async () => {
    const res = await updateEasyExpressExcludedCarriers(["   ", ""]);

    expect(res.success).toBe(true);
    expect(mockSiteConfigDeleteMany).toHaveBeenCalled();
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
  });

  it("rejette un argument qui n'est pas un tableau", async () => {
    const res = await updateEasyExpressExcludedCarriers(
      // @ts-expect-error — on teste le garde-fou runtime.
      "pas-un-tableau",
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/format/i);
  });

  it("rejette les non-admins", async () => {
    const nextAuth = await import("next-auth");
    vi.mocked(nextAuth.getServerSession).mockResolvedValueOnce(null as never);

    const res = await updateEasyExpressExcludedCarriers(["Chronopost"]);

    expect(res.success).toBe(false);
    expect(mockSetSiteConfig).not.toHaveBeenCalled();
    expect(mockSiteConfigDeleteMany).not.toHaveBeenCalled();
  });

  it("revalide le tag site-config pour que le filtre /api/carriers prenne effet", async () => {
    await updateEasyExpressExcludedCarriers(["Chronopost"]);

    expect(mockRevalidateTag).toHaveBeenCalledWith("site-config", "default");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/parametres");
  });
});
