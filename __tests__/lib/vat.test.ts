import { describe, it, expect } from "vitest";
import {
  resolveVatRate,
  isEuNonFrance,
  isDomTom,
  EU_COUNTRIES,
  DOM_TOM_COUNTRIES,
  COUNTRIES,
  getCountry,
  FR_VAT_RATE,
} from "@/lib/vat";

describe("resolveVatRate", () => {
  describe("retrait en boutique (pickup)", () => {
    it("applique 20 % pour un client français", () => {
      expect(
        resolveVatRate({ countryCode: "FR", isPickup: true, vatExempt: false }),
      ).toBe(0.2);
    });

    it("applique 20 % à un client UE non exonéré (TVA non validée)", () => {
      expect(
        resolveVatRate({ countryCode: "DE", isPickup: true, vatExempt: false }),
      ).toBe(0.2);
    });

    it("applique 0 % à un client UE exonéré (auto-liquidation B2B intracom)", () => {
      // Règle métier : si l'admin a validé le numéro de TVA d'un client UE
      // hors France, il bénéficie de l'exonération même en retrait boutique.
      expect(
        resolveVatRate({ countryCode: "DE", isPickup: true, vatExempt: true }),
      ).toBe(0);
    });

    it("applique 0 % pour un DOM-TOM", () => {
      expect(
        resolveVatRate({ countryCode: "GP", isPickup: true, vatExempt: false }),
      ).toBe(0);
    });

    it("applique 0 % pour un client hors UE (Suisse)", () => {
      expect(
        resolveVatRate({ countryCode: "CH", isPickup: true, vatExempt: false }),
      ).toBe(0);
    });

    it("retombe sur 20 % si pays non renseigné (fallback retrait FR)", () => {
      expect(
        resolveVatRate({ countryCode: null, isPickup: true, vatExempt: false }),
      ).toBe(0.2);
    });
  });

  describe("livraison France métropolitaine", () => {
    it("applique 20 % à un Français non exonéré", () => {
      expect(
        resolveVatRate({ countryCode: "FR", isPickup: false, vatExempt: false }),
      ).toBe(0.2);
    });

    it("applique 20 % à un Français même si vatExempt cocherait par erreur", () => {
      // L'exonération admin ne s'applique pas aux Français.
      expect(
        resolveVatRate({ countryCode: "FR", isPickup: false, vatExempt: true }),
      ).toBe(0.2);
    });

    it("est insensible à la casse", () => {
      expect(
        resolveVatRate({ countryCode: "fr", isPickup: false, vatExempt: false }),
      ).toBe(0.2);
    });
  });

  describe("livraison DOM-TOM", () => {
    it.each([
      ["GP", "Guadeloupe"],
      ["MQ", "Martinique"],
      ["GF", "Guyane"],
      ["YT", "Mayotte"],
      ["RE", "La Réunion"],
      ["NC", "Nouvelle-Calédonie"],
      ["PF", "Polynésie"],
    ])("n'applique pas de TVA à %s (%s)", (code) => {
      expect(
        resolveVatRate({ countryCode: code, isPickup: false, vatExempt: false }),
      ).toBe(0);
    });
  });

  describe("livraison UE hors France", () => {
    it("applique 20 % par défaut (TVA non validée)", () => {
      expect(
        resolveVatRate({ countryCode: "DE", isPickup: false, vatExempt: false }),
      ).toBe(0.2);
    });

    it("applique 0 % si l'admin a validé l'exonération", () => {
      expect(
        resolveVatRate({ countryCode: "DE", isPickup: false, vatExempt: true }),
      ).toBe(0);
    });

    it.each([
      ["AT"], ["BE"], ["BG"], ["CY"], ["CZ"], ["DE"], ["DK"], ["EE"], ["ES"],
      ["FI"], ["GR"], ["HR"], ["HU"], ["IE"], ["IT"], ["LT"], ["LU"], ["LV"],
      ["MT"], ["NL"], ["PL"], ["PT"], ["RO"], ["SE"], ["SI"], ["SK"],
    ])("non exonéré → 20 % pour %s", (code) => {
      expect(
        resolveVatRate({ countryCode: code, isPickup: false, vatExempt: false }),
      ).toBe(0.2);
    });

    it.each([
      ["AT"], ["DE"], ["IT"], ["ES"], ["BE"],
    ])("exonéré → 0 % pour %s", (code) => {
      expect(
        resolveVatRate({ countryCode: code, isPickup: false, vatExempt: true }),
      ).toBe(0);
    });
  });

  describe("livraison hors UE", () => {
    it.each([
      ["CH", "Suisse"],
      ["GB", "Royaume-Uni"],
      ["US", "États-Unis"],
      ["MA", "Maroc"],
      ["JP", "Japon"],
    ])("n'applique pas de TVA à %s (%s)", (code) => {
      expect(
        resolveVatRate({ countryCode: code, isPickup: false, vatExempt: false }),
      ).toBe(0);
    });

    it("le flag vatExempt est sans effet hors UE", () => {
      expect(
        resolveVatRate({ countryCode: "US", isPickup: false, vatExempt: true }),
      ).toBe(0);
    });
  });

  describe("pays inconnu / vide", () => {
    it("0 % si countryCode est null", () => {
      expect(
        resolveVatRate({ countryCode: null, isPickup: false, vatExempt: false }),
      ).toBe(0);
    });

    it("0 % si countryCode est undefined", () => {
      expect(
        resolveVatRate({ countryCode: undefined, isPickup: false, vatExempt: false }),
      ).toBe(0);
    });

    it("0 % pour un code pays inconnu", () => {
      expect(
        resolveVatRate({ countryCode: "ZZ", isPickup: false, vatExempt: false }),
      ).toBe(0);
    });
  });
});

describe("isEuNonFrance", () => {
  it("vrai pour Allemagne", () => {
    expect(isEuNonFrance("DE")).toBe(true);
  });

  it("faux pour France", () => {
    expect(isEuNonFrance("FR")).toBe(false);
  });

  it("faux pour DOM-TOM", () => {
    expect(isEuNonFrance("GP")).toBe(false);
  });

  it("faux pour hors UE", () => {
    expect(isEuNonFrance("CH")).toBe(false);
  });

  it("faux pour null/undefined/vide", () => {
    expect(isEuNonFrance(null)).toBe(false);
    expect(isEuNonFrance(undefined)).toBe(false);
    expect(isEuNonFrance("")).toBe(false);
  });

  it("est insensible à la casse", () => {
    expect(isEuNonFrance("de")).toBe(true);
  });
});

describe("isDomTom", () => {
  it("vrai pour Guadeloupe", () => {
    expect(isDomTom("GP")).toBe(true);
  });

  it("faux pour France métropolitaine", () => {
    expect(isDomTom("FR")).toBe(false);
  });

  it("faux pour Allemagne", () => {
    expect(isDomTom("DE")).toBe(false);
  });
});

describe("constants", () => {
  it("FR_VAT_RATE vaut 0.2", () => {
    expect(FR_VAT_RATE).toBe(0.2);
  });

  it("EU_COUNTRIES contient bien la France", () => {
    expect(EU_COUNTRIES.has("FR")).toBe(true);
  });

  it("EU_COUNTRIES n'inclut pas le Royaume-Uni", () => {
    expect(EU_COUNTRIES.has("GB")).toBe(false);
  });

  it("DOM_TOM_COUNTRIES n'inclut pas la France métropolitaine", () => {
    expect(DOM_TOM_COUNTRIES.has("FR")).toBe(false);
  });

  it("COUNTRIES contient la France en première position", () => {
    expect(COUNTRIES[0]).toMatchObject({ code: "FR", region: "EU" });
  });

  it("getCountry retrouve un pays par code", () => {
    expect(getCountry("DE")?.name).toBe("Allemagne");
    expect(getCountry("de")?.name).toBe("Allemagne");
  });

  it("getCountry renvoie null si inconnu", () => {
    expect(getCountry("ZZ")).toBeNull();
    expect(getCountry(null)).toBeNull();
  });
});
