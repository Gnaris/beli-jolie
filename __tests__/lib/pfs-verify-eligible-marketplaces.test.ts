/**
 * Tests unitaires : logique de choix des marketplaces éligibles à un push
 * après un « Prendre PFS ». On mocke Prisma + les caches SiteConfig pour
 * vérifier les 4 garde-fous (lié / non désactivé produit / non désactivé
 * système / configuré).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockAnkorsEnabled = vi.fn();
const mockEfashionEnabled = vi.fn();
const mockFaireEnabled = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedAnkorstoreEnabled: () => mockAnkorsEnabled(),
  getCachedEfashionEnabled: () => mockEfashionEnabled(),
  getCachedFaireEnabled: () => mockFaireEnabled(),
}));

// Import APRÈS les mocks
import { computePfsPullEligibleMarketplaces } from "@/lib/pfs-verify-eligible-marketplaces";

beforeEach(() => {
  mockFindUnique.mockReset();
  mockAnkorsEnabled.mockReset();
  mockEfashionEnabled.mockReset();
  mockFaireEnabled.mockReset();
});

describe("computePfsPullEligibleMarketplaces", () => {
  it("retourne les 3 marketplaces quand tout est OK", async () => {
    mockFindUnique.mockResolvedValue({
      ankorsProductId: "ANK-1",
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: "FAI-1",
      faireEnabled: true,
      colors: [{ efashionProductId: 42 }],
    });
    mockAnkorsEnabled.mockResolvedValue(true);
    mockEfashionEnabled.mockResolvedValue(true);
    mockFaireEnabled.mockResolvedValue(true);

    const res = await computePfsPullEligibleMarketplaces("prod-1");
    expect(res.sort()).toEqual(["ankorstore", "efashion", "faire"]);
  });

  it("exclut Ankorstore si le produit n'y est pas lié (ankorsProductId=null)", async () => {
    mockFindUnique.mockResolvedValue({
      ankorsProductId: null,
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: "FAI-1",
      faireEnabled: true,
      colors: [{ efashionProductId: 42 }],
    });
    mockAnkorsEnabled.mockResolvedValue(true);
    mockEfashionEnabled.mockResolvedValue(true);
    mockFaireEnabled.mockResolvedValue(true);

    const res = await computePfsPullEligibleMarketplaces("prod-1");
    expect(res).not.toContain("ankorstore");
    expect(res).toContain("efashion");
    expect(res).toContain("faire");
  });

  it("exclut eFashion si aucune couleur n'y est liée", async () => {
    mockFindUnique.mockResolvedValue({
      ankorsProductId: "ANK-1",
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: "FAI-1",
      faireEnabled: true,
      colors: [{ efashionProductId: null }, { efashionProductId: null }],
    });
    mockAnkorsEnabled.mockResolvedValue(true);
    mockEfashionEnabled.mockResolvedValue(true);
    mockFaireEnabled.mockResolvedValue(true);

    const res = await computePfsPullEligibleMarketplaces("prod-1");
    expect(res).not.toContain("efashion");
  });

  it("exclut Faire si désactivé au niveau du produit (faireEnabled=false)", async () => {
    mockFindUnique.mockResolvedValue({
      ankorsProductId: "ANK-1",
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: "FAI-1",
      faireEnabled: false,
      colors: [{ efashionProductId: 42 }],
    });
    mockAnkorsEnabled.mockResolvedValue(true);
    mockEfashionEnabled.mockResolvedValue(true);
    mockFaireEnabled.mockResolvedValue(true);

    const res = await computePfsPullEligibleMarketplaces("prod-1");
    expect(res).not.toContain("faire");
  });

  it("exclut Ankorstore si le kill switch système est off", async () => {
    mockFindUnique.mockResolvedValue({
      ankorsProductId: "ANK-1",
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: "FAI-1",
      faireEnabled: true,
      colors: [{ efashionProductId: 42 }],
    });
    mockAnkorsEnabled.mockResolvedValue(false);
    mockEfashionEnabled.mockResolvedValue(true);
    mockFaireEnabled.mockResolvedValue(true);

    const res = await computePfsPullEligibleMarketplaces("prod-1");
    expect(res).not.toContain("ankorstore");
  });

  it("retourne un tableau vide si le produit n'existe pas", async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await computePfsPullEligibleMarketplaces("nope");
    expect(res).toEqual([]);
  });

  it("ne contient JAMAIS PFS (source du pull, exclue par design)", async () => {
    mockFindUnique.mockResolvedValue({
      ankorsProductId: "ANK-1",
      ankorsEnabled: true,
      efashionEnabled: true,
      faireProductId: "FAI-1",
      faireEnabled: true,
      colors: [{ efashionProductId: 42 }],
    });
    mockAnkorsEnabled.mockResolvedValue(true);
    mockEfashionEnabled.mockResolvedValue(true);
    mockFaireEnabled.mockResolvedValue(true);

    const res = await computePfsPullEligibleMarketplaces("prod-1");
    expect(res).not.toContain("pfs" as unknown as (typeof res)[number]);
  });
});
