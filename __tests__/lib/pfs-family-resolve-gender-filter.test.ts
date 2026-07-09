import { describe, it, expect } from "vitest";
import { matchPfsFamilyId, matchPfsCategoryId } from "@/lib/pfs-family-resolve";

/**
 * Régression : la catégorie « Chaîne de corps » (genre WOMAN, famille
 * « Accessoires », catégorie PFS « Corps ») ne se publiait plus car les
 * résolveurs `resolvePfsCategoryIds` de pfs-publish/update/refresh cherchaient
 * la famille par nom sans filtrer par genre. Chez PFS, « Accessoires » existe
 * en WOMAN / MAN / KID, et le premier retour tombait sur la mauvaise famille
 * — la catégorie « Corps » cherchée dedans n'était plus jamais trouvée.
 */

const FAMILIES = [
  { id: "FAM_KID_ACCESS", gender: "KID", labels: { fr: "Accessoires" } },
  { id: "FAM_WOMAN_ACCESS", gender: "WOMAN", labels: { fr: "Accessoires" } },
  { id: "FAM_MAN_ACCESS", gender: "MAN", labels: { fr: "Accessoires" } },
  { id: "FAM_WOMAN_BIJOUX", gender: "WOMAN", labels: { fr: "Bijoux Fantaisie" } },
];

const CATEGORIES = [
  {
    id: "CAT_MAN_CORPS",
    gender: "MAN",
    family: { id: "FAM_MAN_ACCESS" },
    labels: { fr: "Corps" },
  },
  {
    id: "CAT_WOMAN_CORPS",
    gender: "WOMAN",
    family: { id: "FAM_WOMAN_ACCESS" },
    labels: { fr: "Corps" },
  },
  {
    id: "CAT_WOMAN_BAGUES",
    gender: "WOMAN",
    family: { id: "FAM_WOMAN_BIJOUX" },
    labels: { fr: "Bagues" },
  },
];

describe("matchPfsFamilyId — filtre par genre", () => {
  it("retourne la famille WOMAN quand le genre demandé est WOMAN", () => {
    const id = matchPfsFamilyId(FAMILIES, "Accessoires", "WOMAN");
    expect(id).toBe("FAM_WOMAN_ACCESS");
  });

  it("retourne la famille MAN quand le genre demandé est MAN", () => {
    const id = matchPfsFamilyId(FAMILIES, "Accessoires", "MAN");
    expect(id).toBe("FAM_MAN_ACCESS");
  });

  it("retourne la famille KID quand le genre demandé est KID", () => {
    const id = matchPfsFamilyId(FAMILIES, "Accessoires", "KID");
    expect(id).toBe("FAM_KID_ACCESS");
  });

  it("normalise underscores et casse (Bijoux_Fantaisie ↔ Bijoux Fantaisie)", () => {
    const id = matchPfsFamilyId(FAMILIES, "Bijoux_Fantaisie", "WOMAN");
    expect(id).toBe("FAM_WOMAN_BIJOUX");
  });

  it("retourne null si le nom ne matche aucune famille", () => {
    const id = matchPfsFamilyId(FAMILIES, "Inexistant", "WOMAN");
    expect(id).toBeNull();
  });

  it("retourne null si le nom est absent", () => {
    expect(matchPfsFamilyId(FAMILIES, null, "WOMAN")).toBeNull();
    expect(matchPfsFamilyId(FAMILIES, "", "WOMAN")).toBeNull();
  });

  it("sans genre : garde le comportement historique (premier match)", () => {
    const id = matchPfsFamilyId(FAMILIES, "Accessoires", null);
    expect(id).toBe("FAM_KID_ACCESS");
  });
});

describe("matchPfsCategoryId — filtre par genre + famille", () => {
  it("retourne la catégorie WOMAN Corps quand le genre est WOMAN", () => {
    const id = matchPfsCategoryId(CATEGORIES, "Corps", "WOMAN", "FAM_WOMAN_ACCESS");
    expect(id).toBe("CAT_WOMAN_CORPS");
  });

  it("retourne la catégorie MAN Corps quand le genre est MAN", () => {
    const id = matchPfsCategoryId(CATEGORIES, "Corps", "MAN", "FAM_MAN_ACCESS");
    expect(id).toBe("CAT_MAN_CORPS");
  });

  it("filtre par genre même sans familyId connu", () => {
    const id = matchPfsCategoryId(CATEGORIES, "Corps", "WOMAN", null);
    expect(id).toBe("CAT_WOMAN_CORPS");
  });

  it("filtre par familyId même sans genre connu", () => {
    const id = matchPfsCategoryId(CATEGORIES, "Corps", null, "FAM_MAN_ACCESS");
    expect(id).toBe("CAT_MAN_CORPS");
  });

  it("retourne null si le nom est absent", () => {
    expect(matchPfsCategoryId(CATEGORIES, null, "WOMAN", null)).toBeNull();
    expect(matchPfsCategoryId(CATEGORIES, "", "WOMAN", null)).toBeNull();
  });

  it("retourne null si aucune catégorie ne matche", () => {
    const id = matchPfsCategoryId(CATEGORIES, "Corps", "KID", null);
    expect(id).toBeNull();
  });
});
