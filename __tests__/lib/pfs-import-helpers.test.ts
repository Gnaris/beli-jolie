import { describe, it, expect } from "vitest";
import {
  pickDefaultImage,
  collectImagesForColors,
  findPrimaryPfsColorRef,
  findPrimaryPfsColorRefFromImages,
  dedupeSizeEntries,
  pfsColorMatchCandidates,
  buildPackLinesFromResolved,
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

  describe("dedupeSizeEntries", () => {
    it("retourne tableau vide pour entrée vide", () => {
      expect(dedupeSizeEntries([])).toEqual([]);
    });

    it("conserve les entrées uniques telles quelles", () => {
      const entries = [
        { sizeId: "size-S", quantity: 1 },
        { sizeId: "size-M", quantity: 2 },
        { sizeId: "size-L", quantity: 3 },
      ];
      const result = dedupeSizeEntries(entries);
      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining(entries));
    });

    it("additionne les quantités quand le même sizeId apparaît plusieurs fois", () => {
      const entries = [
        { sizeId: "size-M", quantity: 2 },
        { sizeId: "size-M", quantity: 3 },
      ];
      expect(dedupeSizeEntries(entries)).toEqual([{ sizeId: "size-M", quantity: 5 }]);
    });

    it("gère un mix de doublons et d'uniques (cas pack multi-couleurs)", () => {
      // Cas réel : pack tricolore PFS avec Rouge M×2 + Bleu M×3 + Noir L×1
      // Doit produire M=5 et L=1 pour un seul ProductColor.
      const entries = [
        { sizeId: "size-M", quantity: 2 },
        { sizeId: "size-M", quantity: 3 },
        { sizeId: "size-L", quantity: 1 },
      ];
      const result = dedupeSizeEntries(entries);
      expect(result).toHaveLength(2);
      const m = result.find((r) => r.sizeId === "size-M");
      const l = result.find((r) => r.sizeId === "size-L");
      expect(m?.quantity).toBe(5);
      expect(l?.quantity).toBe(1);
    });
  });

  describe("pfsColorMatchCandidates", () => {
    it("priorise le libellé français devant le code en majuscules", () => {
      const c = {
        reference: "DARK_GRAY",
        labels: { fr: "Gris Foncé", en: "Dark Gray", de: "Dunkelgrau" },
      };
      const candidates = pfsColorMatchCandidates(c);
      expect(candidates[0]).toBe("Gris Foncé");
      expect(candidates).toContain("DARK_GRAY");
      expect(candidates.indexOf("Gris Foncé")).toBeLessThan(
        candidates.indexOf("DARK_GRAY"),
      );
    });

    it("essaie aussi en, de, es, it dans cet ordre quand fr manque", () => {
      const c = {
        reference: "BICOLOR",
        labels: { en: "Bicolor", de: "Zweifarbig" },
      };
      const candidates = pfsColorMatchCandidates(c);
      expect(candidates).toEqual(["Bicolor", "Zweifarbig", "BICOLOR"]);
    });

    it("retombe sur la reference si labels vide ou absent", () => {
      expect(pfsColorMatchCandidates({ reference: "ECRU" })).toEqual(["ECRU"]);
      expect(pfsColorMatchCandidates({ reference: "ECRU", labels: {} })).toEqual([
        "ECRU",
      ]);
      expect(
        pfsColorMatchCandidates({ reference: "ECRU", labels: null }),
      ).toEqual(["ECRU"]);
    });

    it("supprime les doublons exacts entre langues", () => {
      const c = {
        reference: "ROSE",
        labels: { fr: "Rose", en: "Rose", de: "Rose" },
      };
      const candidates = pfsColorMatchCandidates(c);
      // "Rose" déduit une seule fois entre fr/en/de, plus le code "ROSE"
      // (différent par la casse, gardé pour fallback exact si la BDD le contient)
      expect(candidates).toEqual(["Rose", "ROSE"]);
    });

    it("ignore les libellés vides ou whitespace seul", () => {
      const c = {
        reference: "X",
        labels: { fr: "", en: "   ", de: "Schwarz" },
      };
      const candidates = pfsColorMatchCandidates(c);
      expect(candidates).toEqual(["Schwarz", "X"]);
    });
  });

  describe("buildPackLinesFromResolved", () => {
    it("retourne tout vide si aucun pack", () => {
      expect(buildPackLinesFromResolved([])).toEqual({
        sizeEntries: [],
        packLines: [],
        allColorIds: [],
      });
    });

    it("PACK mono-couleur (1 ligne) : sizeEntries fusionné, packLines vide", () => {
      const result = buildPackLinesFromResolved([
        {
          colorId: "color-ecru",
          sizeEntries: [
            { sizeId: "size-48", quantity: 13 },
            { sizeId: "size-49", quantity: 8 },
          ],
        },
      ]);
      expect(result.packLines).toEqual([]);
      expect(result.sizeEntries).toEqual([
        { sizeId: "size-48", quantity: 13 },
        { sizeId: "size-49", quantity: 8 },
      ]);
      expect(result.allColorIds).toEqual(["color-ecru"]);
    });

    it("PACK mono-couleur réparti sur plusieurs entrées PFS : fusionne par taille", () => {
      const result = buildPackLinesFromResolved([
        { colorId: "color-ecru", sizeEntries: [{ sizeId: "size-48", quantity: 5 }] },
        { colorId: "color-ecru", sizeEntries: [{ sizeId: "size-48", quantity: 3 }, { sizeId: "size-49", quantity: 2 }] },
      ]);
      expect(result.packLines).toEqual([]);
      expect(result.sizeEntries).toHaveLength(2);
      expect(result.sizeEntries.find((e) => e.sizeId === "size-48")?.quantity).toBe(8);
      expect(result.sizeEntries.find((e) => e.sizeId === "size-49")?.quantity).toBe(2);
    });

    it("PACK multi-couleurs : 1 packLine par couleur, sizeEntries vide", () => {
      // Cas réel TESTGGG : pack tricolore Gris Foncé + Ivoire + Écru, tailles 56-59.
      const result = buildPackLinesFromResolved([
        {
          colorId: "color-gris",
          sizeEntries: [
            { sizeId: "size-56", quantity: 1 },
            { sizeId: "size-57", quantity: 2 },
            { sizeId: "size-58", quantity: 3 },
            { sizeId: "size-59", quantity: 4 },
          ],
        },
        {
          colorId: "color-ivoire",
          sizeEntries: [
            { sizeId: "size-56", quantity: 1 },
            { sizeId: "size-57", quantity: 2 },
            { sizeId: "size-58", quantity: 3 },
            { sizeId: "size-59", quantity: 4 },
          ],
        },
        {
          colorId: "color-ecru",
          sizeEntries: [
            { sizeId: "size-56", quantity: 1 },
            { sizeId: "size-57", quantity: 2 },
            { sizeId: "size-58", quantity: 3 },
            { sizeId: "size-59", quantity: 4 },
          ],
        },
      ]);
      expect(result.sizeEntries).toEqual([]);
      expect(result.packLines).toHaveLength(3);
      expect(result.packLines[0].colorId).toBe("color-gris");
      expect(result.packLines[1].colorId).toBe("color-ivoire");
      expect(result.packLines[2].colorId).toBe("color-ecru");
      expect(result.allColorIds).toEqual(["color-gris", "color-ivoire", "color-ecru"]);
      // Total pièces du pack = 3 couleurs × (1+2+3+4) = 30
      const totalPieces = result.packLines.reduce(
        (sum, l) => sum + l.sizeEntries.reduce((s, e) => s + e.quantity, 0),
        0,
      );
      expect(totalPieces).toBe(30);
    });

    it("préserve l'ordre PFS des couleurs (la première = couleur principale)", () => {
      const result = buildPackLinesFromResolved([
        { colorId: "color-rouge", sizeEntries: [{ sizeId: "size-M", quantity: 1 }] },
        { colorId: "color-bleu", sizeEntries: [{ sizeId: "size-L", quantity: 1 }] },
        { colorId: "color-noir", sizeEntries: [{ sizeId: "size-S", quantity: 1 }] },
      ]);
      expect(result.allColorIds).toEqual(["color-rouge", "color-bleu", "color-noir"]);
    });

    it("multi-couleurs avec doublons de couleur : fusionne en une seule ligne", () => {
      const result = buildPackLinesFromResolved([
        { colorId: "color-rouge", sizeEntries: [{ sizeId: "size-M", quantity: 2 }] },
        { colorId: "color-bleu", sizeEntries: [{ sizeId: "size-M", quantity: 3 }] },
        { colorId: "color-rouge", sizeEntries: [{ sizeId: "size-L", quantity: 1 }] },
      ]);
      expect(result.packLines).toHaveLength(2);
      const rouge = result.packLines.find((l) => l.colorId === "color-rouge");
      expect(rouge?.sizeEntries).toHaveLength(2);
      expect(rouge?.sizeEntries.find((e) => e.sizeId === "size-M")?.quantity).toBe(2);
      expect(rouge?.sizeEntries.find((e) => e.sizeId === "size-L")?.quantity).toBe(1);
    });
  });
});
