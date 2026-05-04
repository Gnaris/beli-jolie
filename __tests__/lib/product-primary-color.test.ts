import { describe, it, expect } from "vitest";
import {
  getProductPrimaryColorId,
  listAvailableColorIds,
  resolvePrimaryColorId,
} from "@/lib/product-primary-color";

describe("getProductPrimaryColorId", () => {
  it("retourne primaryColorId quand il est renseigné", () => {
    const product = {
      primaryColorId: "kaki",
      colors: [{ colorId: "rouge", isPrimary: false }],
    };
    expect(getProductPrimaryColorId(product)).toBe("kaki");
  });

  it("fallback sur la variante isPrimary=true quand primaryColorId est null", () => {
    const product = {
      primaryColorId: null,
      colors: [
        { colorId: "rouge", isPrimary: false },
        { colorId: "kaki", isPrimary: true },
        { colorId: "bleu", isPrimary: false },
      ],
    };
    expect(getProductPrimaryColorId(product)).toBe("kaki");
  });

  it("fallback ultime sur la 1ʳᵉ variante avec une couleur quand aucune n'est isPrimary", () => {
    const product = {
      primaryColorId: null,
      colors: [
        { colorId: null, isPrimary: false },
        { colorId: "rouge", isPrimary: false },
        { colorId: "kaki", isPrimary: false },
      ],
    };
    expect(getProductPrimaryColorId(product)).toBe("rouge");
  });

  it("fallback sur la 1ʳᵉ pack-line quand aucune variante n'a de colorId", () => {
    const product = {
      primaryColorId: null,
      colors: [
        {
          colorId: null,
          isPrimary: false,
          packLines: [{ colorId: "orange" }, { colorId: "vert" }],
        },
      ],
    };
    expect(getProductPrimaryColorId(product)).toBe("orange");
  });

  it("retourne null quand le produit n'a aucune couleur", () => {
    const product = { primaryColorId: null, colors: [] };
    expect(getProductPrimaryColorId(product)).toBeNull();
  });

  it("primaryColorId prime même si aucune variante ne porte cette couleur", () => {
    const product = {
      primaryColorId: "orange",
      colors: [
        { colorId: "kaki", isPrimary: true, packLines: [{ colorId: "orange" }] },
      ],
    };
    expect(getProductPrimaryColorId(product)).toBe("orange");
  });
});

describe("listAvailableColorIds", () => {
  it("liste les couleurs des variantes dans l'ordre d'apparition", () => {
    const product = {
      colors: [
        { colorId: "rouge", isPrimary: false },
        { colorId: "kaki", isPrimary: false },
        { colorId: "bleu", isPrimary: false },
      ],
    };
    expect(listAvailableColorIds(product)).toEqual(["rouge", "kaki", "bleu"]);
  });

  it("inclut les couleurs des pack-lines après celles des variantes", () => {
    const product = {
      colors: [
        {
          colorId: "kaki",
          isPrimary: false,
          packLines: [{ colorId: "orange" }, { colorId: "vert" }],
        },
        { colorId: "bleu", isPrimary: false },
      ],
    };
    expect(listAvailableColorIds(product)).toEqual(["kaki", "orange", "vert", "bleu"]);
  });

  it("dédupe les couleurs présentes dans plusieurs variantes ou pack-lines", () => {
    const product = {
      colors: [
        {
          colorId: "kaki",
          isPrimary: false,
          packLines: [{ colorId: "kaki" }, { colorId: "orange" }],
        },
        { colorId: "kaki", isPrimary: false },
      ],
    };
    expect(listAvailableColorIds(product)).toEqual(["kaki", "orange"]);
  });

  it("ignore les couleurs nulles", () => {
    const product = {
      colors: [
        { colorId: null, isPrimary: false },
        { colorId: "kaki", isPrimary: false },
      ],
    };
    expect(listAvailableColorIds(product)).toEqual(["kaki"]);
  });
});

describe("resolvePrimaryColorId", () => {
  it("garde la valeur courante si elle est dans la liste disponible", () => {
    expect(resolvePrimaryColorId("kaki", ["rouge", "kaki", "bleu"])).toBe("kaki");
  });

  it("réassigne sur la 1ʳᵉ disponible si la valeur courante n'y est plus", () => {
    expect(resolvePrimaryColorId("orange", ["rouge", "kaki", "bleu"])).toBe("rouge");
  });

  it("retourne null si aucune couleur n'est disponible", () => {
    expect(resolvePrimaryColorId("kaki", [])).toBeNull();
  });

  it("retourne la 1ʳᵉ couleur disponible si la valeur courante est null", () => {
    expect(resolvePrimaryColorId(null, ["rouge", "kaki"])).toBe("rouge");
  });

  it("retourne null si la valeur courante et la liste sont vides", () => {
    expect(resolvePrimaryColorId(null, [])).toBeNull();
    expect(resolvePrimaryColorId(undefined, [])).toBeNull();
  });
});
