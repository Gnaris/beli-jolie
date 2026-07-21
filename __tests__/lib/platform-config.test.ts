/**
 * Tests unitaires pour lib/platform-config.
 *
 * Objectif : garantir que la lecture des flags maintenance renvoie bien un
 * objet booléen par marketplace, que l'écriture invalide le cache, et que
 * les libellés/messages restent en français lisible pour la cliente.
 *
 * On mocke Prisma + Next.js cache pour rester en unit test rapide (pas de DB).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PLATFORM_KEYS,
  MARKETPLACES,
  MARKETPLACE_LABELS,
  marketplaceMaintenanceMessage,
} from "@/lib/platform-config";

const findManyMock = vi.fn();
const upsertMock = vi.fn();
const revalidateTagMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformConfig: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

// unstable_cache doit se comporter comme un passthrough (exécute la fn) pour
// que la lecture aille bien à Prisma dans le test. revalidateTag est spy.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: (...args: unknown[]) => revalidateTagMock(...args),
}));

beforeEach(() => {
  findManyMock.mockReset();
  upsertMock.mockReset();
  revalidateTagMock.mockReset();
});

describe("getMarketplaceMaintenance", () => {
  it("retourne false pour toutes les marketplaces quand aucun flag n'est stocké", async () => {
    findManyMock.mockResolvedValueOnce([]);
    const { getMarketplaceMaintenance } = await import("@/lib/platform-config");
    const flags = await getMarketplaceMaintenance();
    expect(flags).toEqual({
      pfs: false,
      ankorstore: false,
      efashion: false,
      faire: false,
    });
  });

  it("interprète 'true' → true et 'false' / autres → false", async () => {
    findManyMock.mockResolvedValueOnce([
      { key: PLATFORM_KEYS.pfsMaintenance, value: "true" },
      { key: PLATFORM_KEYS.ankorstoreMaintenance, value: "false" },
      { key: PLATFORM_KEYS.efashionMaintenance, value: "true" },
      // faire absent → false par défaut
    ]);
    const { getMarketplaceMaintenance } = await import("@/lib/platform-config");
    const flags = await getMarketplaceMaintenance();
    expect(flags).toEqual({
      pfs: true,
      ankorstore: false,
      efashion: true,
      faire: false,
    });
  });
});

describe("isMarketplaceInMaintenance", () => {
  it("renvoie true pour la marketplace ciblée quand son flag est actif", async () => {
    findManyMock.mockResolvedValueOnce([
      { key: PLATFORM_KEYS.ankorstoreMaintenance, value: "true" },
    ]);
    const { isMarketplaceInMaintenance } = await import("@/lib/platform-config");
    expect(await isMarketplaceInMaintenance("ankorstore")).toBe(true);
  });

  it("renvoie false quand le flag est 'false'", async () => {
    findManyMock.mockResolvedValueOnce([
      { key: PLATFORM_KEYS.pfsMaintenance, value: "false" },
    ]);
    const { isMarketplaceInMaintenance } = await import("@/lib/platform-config");
    expect(await isMarketplaceInMaintenance("pfs")).toBe(false);
  });
});

describe("setMarketplaceMaintenance", () => {
  it("écrit le flag et invalide le cache platform-config", async () => {
    upsertMock.mockResolvedValueOnce({});
    const { setMarketplaceMaintenance } = await import("@/lib/platform-config");
    await setMarketplaceMaintenance("faire", true);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { key: PLATFORM_KEYS.faireMaintenance },
      update: { value: "true" },
      create: { key: PLATFORM_KEYS.faireMaintenance, value: "true" },
    });
    expect(revalidateTagMock).toHaveBeenCalledWith("platform-config", "default");
  });

  it("écrit 'false' quand active = false", async () => {
    upsertMock.mockResolvedValueOnce({});
    const { setMarketplaceMaintenance } = await import("@/lib/platform-config");
    await setMarketplaceMaintenance("pfs", false);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { key: PLATFORM_KEYS.pfsMaintenance },
      update: { value: "false" },
      create: { key: PLATFORM_KEYS.pfsMaintenance, value: "false" },
    });
  });
});

describe("MARKETPLACES + libellés", () => {
  it("expose les 4 marketplaces attendues", () => {
    expect(new Set(MARKETPLACES)).toEqual(
      new Set(["pfs", "ankorstore", "efashion", "faire"]),
    );
  });

  it("a un libellé français pour chaque marketplace", () => {
    for (const mp of MARKETPLACES) {
      expect(MARKETPLACE_LABELS[mp]).toBeTruthy();
      expect(MARKETPLACE_LABELS[mp]).not.toMatch(/^[a-z]+$/); // pas juste la clé technique
    }
  });

  it("le message maintenance mentionne le nom de la marketplace", () => {
    expect(marketplaceMaintenanceMessage("pfs")).toContain("Paris Fashion Shop");
    expect(marketplaceMaintenanceMessage("ankorstore")).toContain("Ankorstore");
    expect(marketplaceMaintenanceMessage("efashion")).toContain("eFashion");
    expect(marketplaceMaintenanceMessage("faire")).toContain("Faire");
  });
});
