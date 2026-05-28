/**
 * Vérifie le pipeline de résolution `resolveEfashionDeclinaison` :
 *  - match via cache (`getEfashionAnnexes`),
 *  - si miss, fresh refresh (`getEfashionAnnexesFresh`) pour rattraper la
 *    déclinaison créée juste avant par un autre produit (anti-doublon),
 *  - sinon, création via `efashionCreateDeclinaison` avec un titre global
 *    qui ne contient QUE les tailles (pas la réf produit ni la catégorie).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/efashion-annexes", () => ({
  getEfashionAnnexes: vi.fn(),
  getEfashionAnnexesFresh: vi.fn(),
}));
vi.mock("@/lib/efashion-api-write", () => ({
  efashionCreateDeclinaison: vi.fn(),
}));
vi.mock("@/lib/efashion-api", () => ({
  efashionGetMe: vi.fn().mockResolvedValue({ id_vendeur: 2017 }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveEfashionDeclinaison } from "@/lib/efashion-declinaison-matcher";
import {
  getEfashionAnnexes,
  getEfashionAnnexesFresh,
} from "@/lib/efashion-annexes";
import { efashionCreateDeclinaison } from "@/lib/efashion-api-write";

const getCacheMock = getEfashionAnnexes as unknown as ReturnType<typeof vi.fn>;
const getFreshMock = getEfashionAnnexesFresh as unknown as ReturnType<typeof vi.fn>;
const createMock = efashionCreateDeclinaison as unknown as ReturnType<typeof vi.fn>;

function annexesWith(decls: Array<{ id: number; titre: string; sizes: string[] }>) {
  return {
    categories: [],
    provenances: [],
    collections: [],
    declinaisons: decls.map((d) => ({
      id: d.id,
      titre: d.titre,
      sizes: d.sizes.map((value, idx) => ({ field: `d${idx + 1}_FR`, value })),
    })),
    colors: [],
    packs: [],
    compositions: [],
    fetchedAt: "2026-05-28T00:00:00Z",
  };
}

describe("resolveEfashionDeclinaison — réutilisation et anti-doublon", () => {
  beforeEach(() => {
    getCacheMock.mockReset();
    getFreshMock.mockReset();
    createMock.mockReset();
  });

  it("match via le cache → aucun fresh fetch, aucune création", async () => {
    getCacheMock.mockResolvedValue(
      annexesWith([
        { id: 50, titre: "BJ Taille unique, XL", sizes: ["Taille unique", "XL"] },
      ]),
    );

    const res = await resolveEfashionDeclinaison(["Taille unique", "XL"]);

    expect(res.success).toBe(true);
    if (res.success) expect(res.match.declinaisonId).toBe(50);
    expect(getFreshMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("fresh refresh retrouve une décli créée hors-cache et la réutilise (anti-doublon)", async () => {
    // Cache vide (= pas encore invalidé), mais l'API live a déjà la décli
    // qu'un autre produit vient de créer il y a quelques secondes.
    getCacheMock.mockResolvedValue(annexesWith([]));
    getFreshMock.mockResolvedValue(
      annexesWith([
        { id: 99, titre: "BJ Taille unique, XL", sizes: ["Taille unique", "XL"] },
      ]),
    );

    const res = await resolveEfashionDeclinaison(["Taille unique", "XL"]);

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.match.declinaisonId).toBe(99);
      expect(res.createdNew).toBeFalsy();
    }
    expect(getFreshMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("crée une nouvelle décli avec un titre global (BJ + tailles, pas de réf produit)", async () => {
    getCacheMock.mockResolvedValue(annexesWith([]));
    getFreshMock.mockResolvedValue(annexesWith([]));
    createMock.mockResolvedValue({
      id_declinaison: "12345",
      titre: "BJ Taille unique, XL",
    });

    // Même si le caller passe une suggestion (réf produit), le titre généré
    // doit IGNORER cette suggestion et utiliser uniquement les tailles.
    const res = await resolveEfashionDeclinaison(
      ["Taille unique", "XL"],
      "HSHDF",
    );

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.createdNew).toBe(true);
      expect(res.match.declinaisonId).toBe(12345);
    }
    expect(createMock).toHaveBeenCalledTimes(1);
    const [{ titre }] = createMock.mock.calls[0];
    expect(titre).not.toContain("HSHDF");
    expect(titre).not.toMatch(/^BJ\b/);
    expect(titre).toContain("Taille unique");
    expect(titre).toContain("XL");
  });

  it("bascule sur format compact quand la liste de tailles est trop longue", async () => {
    getCacheMock.mockResolvedValue(annexesWith([]));
    getFreshMock.mockResolvedValue(annexesWith([]));
    createMock.mockResolvedValue({ id_declinaison: "1", titre: "" });

    // Tailles longues qui font dépasser le format détaillé.
    const sizes = [
      "Taille XS",
      "Taille S",
      "Taille M",
      "Taille L",
      "Taille XL",
      "Taille XXL",
      "Taille XXXL",
    ];
    await resolveEfashionDeclinaison(sizes);

    const [{ titre }] = createMock.mock.calls[0];
    expect(titre.length).toBeLessThanOrEqual(50);
    // Format compact = première-dernière + nombre.
    expect(titre).toMatch(/Taille XS-Taille XXXL/);
    expect(titre).toMatch(/7 tailles/);
  });
});
