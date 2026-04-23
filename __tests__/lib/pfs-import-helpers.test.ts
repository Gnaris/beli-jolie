import { describe, it, expect } from "vitest";
import {
  pickDefaultImage,
  collectImagesForColors,
  findPrimaryPfsColorRef,
  findPrimaryPfsColorRefFromImages,
} from "@/lib/pfs-import";
import type { PfsColorInfo } from "@/lib/pfs-api";

const mkColor = (
  reference: string,
  labels: Partial<Record<"fr" | "en" | "de" | "es" | "it", string>> = {},
): PfsColorInfo => ({
  id: 0,
  reference,
  value: "#000000",
  image: null,
  labels: labels as Record<string, string>,
});

describe("pfs-import helpers", () => {
  describe("pickDefaultImage", () => {
    it("retourne null pour null / undefined / objet vide", () => {
      expect(pickDefaultImage(null)).toBeNull();
      expect(pickDefaultImage(undefined)).toBeNull();
      expect(pickDefaultImage({})).toBeNull();
    });

    it("prend la clé DEFAUT si présente (string)", () => {
      const images = {
        DEFAUT: "https://pfs/img-defaut.jpg",
        OTHER: "https://pfs/other.jpg",
      };
      expect(pickDefaultImage(images)).toBe("https://pfs/img-defaut.jpg");
    });

    it("prend la première image de DEFAUT si tableau", () => {
      const images = {
        DEFAUT: ["https://pfs/img-1.jpg", "https://pfs/img-2.jpg"],
      };
      expect(pickDefaultImage(images)).toBe("https://pfs/img-1.jpg");
    });

    it("supporte les alias DEFAULT / default", () => {
      expect(pickDefaultImage({ DEFAULT: "https://x.jpg" })).toBe("https://x.jpg");
      expect(pickDefaultImage({ default: "https://y.jpg" })).toBe("https://y.jpg");
    });

    it("retombe sur la première image trouvée si pas de clé DEFAUT", () => {
      const images = {
        DORE: "https://pfs/dore.jpg",
        ARGENT: ["https://pfs/argent.jpg"],
      };
      const result = pickDefaultImage(images);
      expect([images.DORE, images.ARGENT[0]]).toContain(result);
    });

    it("ignore les valeurs vides et prend la suivante", () => {
      const images = {
        DEFAUT: "",
        DORE: "https://pfs/dore.jpg",
      };
      expect(pickDefaultImage(images)).toBe("https://pfs/dore.jpg");
    });
  });

  describe("collectImagesForColors", () => {
    it("retourne un tableau vide pour une source null / vide", () => {
      const red = mkColor("RED", { fr: "Rouge" });
      expect(collectImagesForColors(null, [red])).toEqual([]);
      expect(collectImagesForColors(undefined, [red])).toEqual([]);
      expect(collectImagesForColors({}, [red])).toEqual([]);
    });

    it("ne garde que les images de la couleur demandée (pas les autres couleurs)", () => {
      const images = {
        GOLDEN: ["https://pfs/gold-1.jpg", "https://pfs/gold-2.jpg"],
        SILVER: ["https://pfs/silver-1.jpg"],
        DEFAUT: ["https://pfs/defaut.jpg"],
      };
      const gold = mkColor("GOLDEN", { fr: "Doré" });
      const result = collectImagesForColors(images, [gold]);
      expect(result).toEqual(["https://pfs/gold-1.jpg", "https://pfs/gold-2.jpg"]);
      expect(result).not.toContain("https://pfs/silver-1.jpg");
      expect(result).not.toContain("https://pfs/defaut.jpg");
    });

    it("matche la clé par label localisé (ex: 'Doré') quand la référence ne correspond pas", () => {
      const images = {
        "Doré": "https://pfs/dore.jpg",
        "Argent": "https://pfs/argent.jpg",
      };
      const gold = mkColor("GOLDEN", { fr: "Doré", en: "Golden" });
      expect(collectImagesForColors(images, [gold])).toEqual(["https://pfs/dore.jpg"]);
    });

    it("matche sans sensibilité aux accents ni à la casse", () => {
      const images = {
        dore: "https://pfs/1.jpg",
        DORÉ: "https://pfs/2.jpg",
      };
      const gold = mkColor("XX", { fr: "Doré" });
      const result = collectImagesForColors(images, [gold]);
      expect(result).toEqual(expect.arrayContaining(["https://pfs/1.jpg", "https://pfs/2.jpg"]));
      expect(result).toHaveLength(2);
    });

    it("ignore DEFAUT / DEFAULT même si présent dans la source", () => {
      const images = {
        DEFAUT: "https://pfs/defaut.jpg",
        GOLDEN: "https://pfs/gold.jpg",
      };
      const gold = mkColor("GOLDEN");
      expect(collectImagesForColors(images, [gold])).toEqual(["https://pfs/gold.jpg"]);
    });

    it("pour un pack multi-couleurs, collecte les images de toutes ses couleurs", () => {
      const images = {
        GOLDEN: "https://pfs/gold.jpg",
        SILVER: "https://pfs/silver.jpg",
        BRONZE: "https://pfs/bronze.jpg",
      };
      const gold = mkColor("GOLDEN");
      const silver = mkColor("SILVER");
      const result = collectImagesForColors(images, [gold, silver]);
      expect(result).toEqual(expect.arrayContaining(["https://pfs/gold.jpg", "https://pfs/silver.jpg"]));
      expect(result).not.toContain("https://pfs/bronze.jpg");
    });

    it("renvoie tableau vide quand aucune clé ne correspond à la couleur demandée", () => {
      const images = {
        SILVER: "https://pfs/silver.jpg",
        DEFAUT: "https://pfs/defaut.jpg",
      };
      const gold = mkColor("GOLDEN", { fr: "Doré" });
      expect(collectImagesForColors(images, [gold])).toEqual([]);
    });

    it("supporte une valeur string ou string[]", () => {
      const images = {
        GOLDEN: "https://pfs/gold-single.jpg",
        SILVER: ["https://pfs/silver-1.jpg", "https://pfs/silver-2.jpg"],
      };
      expect(collectImagesForColors(images, [mkColor("GOLDEN")])).toEqual(["https://pfs/gold-single.jpg"]);
      expect(collectImagesForColors(images, [mkColor("SILVER")])).toEqual([
        "https://pfs/silver-1.jpg",
        "https://pfs/silver-2.jpg",
      ]);
    });

    it("filtre les URLs vides d'un tableau", () => {
      const images = {
        GOLDEN: ["https://pfs/gold.jpg", "", "https://pfs/gold-2.jpg"],
      };
      expect(collectImagesForColors(images, [mkColor("GOLDEN")])).toEqual([
        "https://pfs/gold.jpg",
        "https://pfs/gold-2.jpg",
      ]);
    });
  });

  describe("findPrimaryPfsColorRef", () => {
    it("retourne null sans source", () => {
      expect(findPrimaryPfsColorRef(null, null)).toBeNull();
      expect(findPrimaryPfsColorRef(undefined, undefined)).toBeNull();
      expect(findPrimaryPfsColorRef("", {})).toBeNull();
    });

    it("priorité à default_color quand présent (normalisé)", () => {
      const ref = findPrimaryPfsColorRef("Doré", {
        DEFAUT: "https://pfs/other.jpg",
        SILVER: "https://pfs/silver.jpg",
      });
      expect(ref).toBe("DORE");
    });

    it("matche DEFAUT contre la couleur qui partage la même image", () => {
      const images = {
        DEFAUT: "https://pfs/gold.jpg",
        GOLDEN: "https://pfs/gold.jpg",
        SILVER: "https://pfs/silver.jpg",
      };
      expect(findPrimaryPfsColorRef(null, images)).toBe("GOLDEN");
    });

    it("compare sur la première image quand valeurs sous forme de tableau", () => {
      const images = {
        DEFAUT: ["https://pfs/gold-1.jpg", "https://pfs/gold-2.jpg"],
        GOLDEN: ["https://pfs/gold-1.jpg", "https://pfs/gold-2.jpg"],
        SILVER: ["https://pfs/silver-1.jpg"],
      };
      expect(findPrimaryPfsColorRef(null, images)).toBe("GOLDEN");
    });

    it("retourne null si aucune couleur ne matche DEFAUT", () => {
      const images = {
        DEFAUT: "https://pfs/mystery.jpg",
        GOLDEN: "https://pfs/gold.jpg",
        SILVER: "https://pfs/silver.jpg",
      };
      expect(findPrimaryPfsColorRef(null, images)).toBeNull();
    });

    it("ignore la clé DEFAUT elle-même dans la comparaison", () => {
      const images = {
        DEFAUT: "https://pfs/x.jpg",
      };
      expect(findPrimaryPfsColorRef(null, images)).toBeNull();
    });

    it("fonctionne avec l'alias DEFAULT (anglais)", () => {
      const images = {
        DEFAULT: "https://pfs/gold.jpg",
        GOLDEN: "https://pfs/gold.jpg",
      };
      expect(findPrimaryPfsColorRef(null, images)).toBe("GOLDEN");
    });
  });

  describe("findPrimaryPfsColorRefFromImages", () => {
    it("ignore default_color et se base uniquement sur les URLs", () => {
      const images = {
        DEFAUT: "https://pfs/silver.jpg",
        GOLDEN: "https://pfs/gold.jpg",
        SILVER: "https://pfs/silver.jpg",
      };
      expect(findPrimaryPfsColorRefFromImages(images)).toBe("SILVER");
    });

    it("retourne null si pas de clé DEFAUT", () => {
      const images = {
        GOLDEN: "https://pfs/gold.jpg",
        SILVER: "https://pfs/silver.jpg",
      };
      expect(findPrimaryPfsColorRefFromImages(images)).toBeNull();
    });
  });
});
