import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Bug : l'API PFS renvoie les libellés de familles avec des espaces
 * ("Bijoux Fantaisie") alors que la taxonomie locale utilise des underscores
 * ("Bijoux_Fantaisie"). Quand l'admin choisissait une famille via la modale
 * de mapping rapide (raccourci ou liste), la valeur "Bijoux Fantaisie" était
 * envoyée au serveur. `sanitizePfsFamilyName()` la rejetait (elle n'est pas
 * dans `PFS_FAMILIES_BY_GENDER`), et la création de catégorie échouait avec
 * « Le genre et la famille Paris Fashion Shop sont obligatoires ».
 *
 * Le fix : `pfs-annexes.ts` aligne le nom de famille sur la taxonomie locale
 * (forme underscorée) quand elle correspond à une famille connue.
 */

const {
  pfsGetGendersSpy,
  pfsGetFamiliesSpy,
  pfsGetCategoriesSpy,
  pfsGetColorsSpy,
  pfsGetCompositionsSpy,
  pfsGetCountriesSpy,
  pfsGetSizesSpy,
  pfsGetCollectionsSpy,
} = vi.hoisted(() => ({
  pfsGetGendersSpy: vi.fn(),
  pfsGetFamiliesSpy: vi.fn(),
  pfsGetCategoriesSpy: vi.fn(),
  pfsGetColorsSpy: vi.fn(),
  pfsGetCompositionsSpy: vi.fn(),
  pfsGetCountriesSpy: vi.fn(),
  pfsGetSizesSpy: vi.fn(),
  pfsGetCollectionsSpy: vi.fn(),
}));

vi.mock("@/lib/pfs-api-write", () => ({
  pfsGetGenders: pfsGetGendersSpy,
  pfsGetFamilies: pfsGetFamiliesSpy,
  pfsGetCategories: pfsGetCategoriesSpy,
  pfsGetColors: pfsGetColorsSpy,
  pfsGetCompositions: pfsGetCompositionsSpy,
  pfsGetCountries: pfsGetCountriesSpy,
  pfsGetSizes: pfsGetSizesSpy,
  pfsGetCollections: pfsGetCollectionsSpy,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getPfsAnnexesFresh } from "@/lib/pfs-annexes";
import { sanitizePfsFamilyName } from "@/lib/pfs-family-resolve";

describe("getPfsAnnexesFresh — normalisation des familles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pfsGetGendersSpy.mockResolvedValue([]);
    pfsGetCategoriesSpy.mockResolvedValue([]);
    pfsGetColorsSpy.mockResolvedValue([]);
    pfsGetCompositionsSpy.mockResolvedValue([]);
    pfsGetCountriesSpy.mockResolvedValue([]);
    pfsGetSizesSpy.mockResolvedValue([]);
    pfsGetCollectionsSpy.mockResolvedValue([]);
  });

  it("convertit 'Bijoux Fantaisie' en 'Bijoux_Fantaisie' pour matcher la taxonomie locale", async () => {
    pfsGetFamiliesSpy.mockResolvedValue([
      { id: "fam-1", labels: { fr: "Bijoux Fantaisie" }, gender: "WOMAN" },
    ]);

    const annexes = await getPfsAnnexesFresh();
    expect(annexes.families).toHaveLength(1);
    expect(annexes.families[0].family).toBe("Bijoux_Fantaisie");
    // Et surtout : la valeur passe la validation côté serveur
    expect(sanitizePfsFamilyName(annexes.families[0].family)).toBe("Bijoux_Fantaisie");
  });

  it("propage le nom underscoré dans les catégories construites depuis la même famille", async () => {
    pfsGetFamiliesSpy.mockResolvedValue([
      { id: "fam-1", labels: { fr: "Bijoux Fantaisie" }, gender: "WOMAN" },
    ]);
    pfsGetCategoriesSpy.mockResolvedValue([
      { id: "cat-1", labels: { fr: "Bagues" }, family: "fam-1", gender: "WOMAN" },
    ]);

    const annexes = await getPfsAnnexesFresh();
    expect(annexes.categories).toHaveLength(1);
    expect(annexes.categories[0]).toMatchObject({
      gender: "Femme",
      family: "Bijoux_Fantaisie",
      category: "Bagues",
    });
  });

  it("garde le label brut quand il n'existe pas dans la taxonomie locale", async () => {
    pfsGetFamiliesSpy.mockResolvedValue([
      { id: "fam-x", labels: { fr: "Famille Inventee" }, gender: "WOMAN" },
    ]);

    const annexes = await getPfsAnnexesFresh();
    expect(annexes.families).toHaveLength(1);
    // Pas de match dans la taxonomie → on garde tel quel (l'admin verra au moins
    // le libellé envoyé par PFS au lieu d'un identifiant brut).
    expect(annexes.families[0].family).toBe("Famille Inventee");
  });

  it("laisse passer un label déjà underscoré tel quel", async () => {
    pfsGetFamiliesSpy.mockResolvedValue([
      { id: "fam-2", labels: { fr: "Accessoires_H" }, gender: "MAN" },
    ]);

    const annexes = await getPfsAnnexesFresh();
    expect(annexes.families[0].family).toBe("Accessoires_H");
  });

  it("ignore les genres inconnus", async () => {
    pfsGetFamiliesSpy.mockResolvedValue([
      { id: "fam-3", labels: { fr: "Bijoux Fantaisie" }, gender: "ALIEN" },
    ]);

    const annexes = await getPfsAnnexesFresh();
    expect(annexes.families).toHaveLength(0);
  });
});
