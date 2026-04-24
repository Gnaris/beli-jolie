import { describe, it, expect } from "vitest";
import {
  inferPfsGenderFromFamily,
  normalizePfsGenderCode,
  validatedPfsCategoryName,
} from "@/lib/pfs-import";

/**
 * Les catégories PFS scannées lors de l'import alimentent le modal de création
 * qui doit pouvoir verrouiller genre + famille + sous-catégorie. On teste que
 * l'inférence à partir du champ `family` renvoyé par PFS est robuste.
 */
describe("pfs-import — inférence taxonomie catégorie", () => {
  describe("inferPfsGenderFromFamily", () => {
    it("retourne WOMAN pour une famille connue côté femme", () => {
      expect(inferPfsGenderFromFamily("Bijoux_Fantaisie")).toBe("WOMAN");
      expect(inferPfsGenderFromFamily("Vêtements")).toBe("WOMAN");
    });

    it("retourne MAN pour une famille connue côté homme", () => {
      expect(inferPfsGenderFromFamily("Vêtements_H")).toBe("MAN");
      expect(inferPfsGenderFromFamily("Bijoux_H")).toBe("MAN");
    });

    it("retourne KID pour une famille enfant", () => {
      expect(inferPfsGenderFromFamily("Fille")).toBe("KID");
      expect(inferPfsGenderFromFamily("Bébé")).toBe("KID");
    });

    it("retourne SUPPLIES pour une famille lifestyle", () => {
      expect(inferPfsGenderFromFamily("Lifestyle")).toBe("SUPPLIES");
      expect(inferPfsGenderFromFamily("Emballages")).toBe("SUPPLIES");
    });

    it("retourne null pour une famille inconnue ou vide", () => {
      expect(inferPfsGenderFromFamily("FamilleInventée")).toBeNull();
      expect(inferPfsGenderFromFamily(null)).toBeNull();
      expect(inferPfsGenderFromFamily(undefined)).toBeNull();
      expect(inferPfsGenderFromFamily("")).toBeNull();
    });
  });

  describe("validatedPfsCategoryName", () => {
    it("retourne la sous-catégorie si elle appartient à la famille", () => {
      expect(validatedPfsCategoryName("Bijoux_Fantaisie", "Bagues")).toBe("Bagues");
      expect(validatedPfsCategoryName("Bijoux_Fantaisie", "Colliers")).toBe("Colliers");
    });

    it("retourne null si la sous-catégorie n'existe pas dans la famille", () => {
      expect(validatedPfsCategoryName("Bijoux_Fantaisie", "Pantalons")).toBeNull();
    });

    it("retourne null pour une famille ou un label vide", () => {
      expect(validatedPfsCategoryName(null, "Bagues")).toBeNull();
      expect(validatedPfsCategoryName("Bijoux_Fantaisie", null)).toBeNull();
      expect(validatedPfsCategoryName(undefined, undefined)).toBeNull();
    });

    it("retourne null pour une famille inconnue du référentiel", () => {
      expect(validatedPfsCategoryName("FamilleInventée", "Bagues")).toBeNull();
    });
  });

  describe("normalizePfsGenderCode", () => {
    it("retourne tel quel un code déjà canonique", () => {
      expect(normalizePfsGenderCode("WOMAN")).toBe("WOMAN");
      expect(normalizePfsGenderCode("MAN")).toBe("MAN");
      expect(normalizePfsGenderCode("KID")).toBe("KID");
      expect(normalizePfsGenderCode("SUPPLIES")).toBe("SUPPLIES");
    });

    it("accepte le libellé FR (Femme / Homme / Enfant) et renvoie le code", () => {
      expect(normalizePfsGenderCode("Femme")).toBe("WOMAN");
      expect(normalizePfsGenderCode("Homme")).toBe("MAN");
      expect(normalizePfsGenderCode("Enfant")).toBe("KID");
    });

    it("accepte les abréviations courantes (F / H / E / L)", () => {
      expect(normalizePfsGenderCode("F")).toBe("WOMAN");
      expect(normalizePfsGenderCode("H")).toBe("MAN");
      expect(normalizePfsGenderCode("E")).toBe("KID");
      expect(normalizePfsGenderCode("L")).toBe("SUPPLIES");
    });

    it("insensible à la casse et aux espaces", () => {
      expect(normalizePfsGenderCode(" woman ")).toBe("WOMAN");
      expect(normalizePfsGenderCode("femme")).toBe("WOMAN");
    });

    it("retourne null pour une valeur vide ou inconnue", () => {
      expect(normalizePfsGenderCode(null)).toBeNull();
      expect(normalizePfsGenderCode(undefined)).toBeNull();
      expect(normalizePfsGenderCode("")).toBeNull();
      expect(normalizePfsGenderCode("Z")).toBeNull();
      expect(normalizePfsGenderCode("Adulte")).toBeNull();
    });
  });
});
