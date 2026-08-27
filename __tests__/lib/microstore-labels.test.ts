/**
 * Vérifie que `getMicrostoreLabelMaps()` :
 *   - Retourne des maps vides quand Microstore n'est pas prêt (kill switch OFF
 *     ou session absente).
 *   - Bâtit correctement les maps id→name à partir des listes Microstore.
 *   - Ne throw jamais, même si une des 3 listes explose (les autres passent).
 *
 * Et que `resolveMicrostoreLabelOrOrphan()` distingue :
 *   - ID trouvé → nom réel.
 *   - ID mappé mais absent Microstore → « #ID (introuvable sur Microstore) ».
 *   - Pas de mapping → null.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstConfigMock = vi.fn();
const getSessionKeyMock = vi.fn();
const listAttrMock = vi.fn();
const listColorsMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { siteConfig: { findFirst: findFirstConfigMock } },
}));
vi.mock("@/lib/tenant-als", () => ({
  getCurrentTenantIdSync: () => "tenant-beliandjolie",
}));
vi.mock("@/lib/microstore-auth", () => ({
  getMicrostoreSessionKey: getSessionKeyMock,
}));
vi.mock("@/lib/microstore-attributes", () => ({
  microstoreListAttribute: listAttrMock,
  microstoreListColors: listColorsMock,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { getMicrostoreLabelMaps, resolveMicrostoreLabelOrOrphan } = await import(
  "@/lib/microstore-labels"
);

beforeEach(() => {
  findFirstConfigMock.mockReset();
  getSessionKeyMock.mockReset();
  listAttrMock.mockReset();
  listColorsMock.mockReset();
  findFirstConfigMock.mockResolvedValue(null); // kill switch défaut ON
  getSessionKeyMock.mockResolvedValue("5_XXX");
});

describe("getMicrostoreLabelMaps", () => {
  it("bâtit les 3 maps depuis les listes Microstore", async () => {
    listAttrMock.mockImplementation(async (type: string) => {
      if (type === "category")
        return [
          { id: "1", name: "Bracelet" },
          { id: "2", name: "Bague" },
        ];
      if (type === "season") return [{ id: "9", name: "Été 2026" }];
      return [];
    });
    listColorsMock.mockResolvedValue([
      { id: "42", name: "Doré" },
      { id: "43", name: "Argenté" },
    ]);

    const maps = await getMicrostoreLabelMaps();

    expect(maps.categories.get(1)).toBe("Bracelet");
    expect(maps.categories.get(2)).toBe("Bague");
    expect(maps.seasons.get(9)).toBe("Été 2026");
    expect(maps.colors.get(42)).toBe("Doré");
    expect(maps.colors.get(43)).toBe("Argenté");
  });

  it("retourne des maps vides quand le kill switch est OFF", async () => {
    findFirstConfigMock.mockResolvedValue({ value: "false" });

    const maps = await getMicrostoreLabelMaps();

    expect(maps.categories.size).toBe(0);
    expect(maps.colors.size).toBe(0);
    expect(maps.seasons.size).toBe(0);
    expect(listAttrMock).not.toHaveBeenCalled();
    expect(listColorsMock).not.toHaveBeenCalled();
  });

  it("retourne des maps vides quand la session est absente", async () => {
    getSessionKeyMock.mockResolvedValue(null);

    const maps = await getMicrostoreLabelMaps();

    expect(maps.categories.size).toBe(0);
    expect(maps.colors.size).toBe(0);
    expect(maps.seasons.size).toBe(0);
  });

  it("isole les échecs partiels : si les couleurs foirent, catégories/saisons passent quand même", async () => {
    listAttrMock.mockImplementation(async (type: string) => {
      if (type === "category") return [{ id: "1", name: "Bracelet" }];
      if (type === "season") return [{ id: "9", name: "Toutes saisons" }];
      return [];
    });
    listColorsMock.mockRejectedValue(new Error("Microstore HTTP 500"));

    const maps = await getMicrostoreLabelMaps();

    expect(maps.categories.get(1)).toBe("Bracelet");
    expect(maps.seasons.get(9)).toBe("Toutes saisons");
    expect(maps.colors.size).toBe(0);
  });

  it("ignore les IDs non-numériques envoyés par Microstore", async () => {
    listAttrMock.mockResolvedValue([{ id: "N/A", name: "Junk" }]);
    listColorsMock.mockResolvedValue([]);

    const maps = await getMicrostoreLabelMaps();

    expect(maps.categories.size).toBe(0);
  });
});

describe("resolveMicrostoreLabelOrOrphan", () => {
  const map = new Map<number, string>([[42, "Doré"]]);

  it("retourne null si aucun ID n'est mappé BJ", () => {
    expect(resolveMicrostoreLabelOrOrphan(map, null)).toBeNull();
    expect(resolveMicrostoreLabelOrOrphan(map, undefined)).toBeNull();
  });

  it("retourne le nom réel si l'ID existe dans la map", () => {
    expect(resolveMicrostoreLabelOrOrphan(map, 42)).toBe("Doré");
  });

  it("retourne un marqueur orphelin si l'ID BJ n'existe plus côté Microstore", () => {
    const label = resolveMicrostoreLabelOrOrphan(map, 99);
    expect(label).toMatch(/#99/);
    expect(label).toMatch(/introuvable/i);
  });
});
