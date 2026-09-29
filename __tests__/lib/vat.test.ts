import { describe, it, expect } from "vitest";
import {
  resolveVatRate,
  isEuNonFrance,
  isDomTom,
  EU_COUNTRIES,
  DOM_TOM_COUNTRIES,
  COUNTRIES,
  getCountry,
  buildDomTomCertificationLabel,
  FR_VAT_RATE,
} from "@/lib/vat";

describe("resolveVatRate — retrait en boutique (mode pickup)", () => {
  // Règle : la marchandise ne quitte pas la métropole en pickup. TVA FR 20 %
  // toujours due, indépendamment du pays de facturation et de vatExempt.
  it.each([
    ["FR", false, 0.2],
    ["FR", true, 0.2],
    ["DE", false, 0.2],
    ["DE", true, 0.2], // UE exonéré : la marchandise reste en FR donc 20 %
    ["GP", false, 0.2], // adresse DOM-TOM mais retrait métropole → 20 %
    ["CH", false, 0.2],
    ["US", true, 0.2],
    [null, false, 0.2],
  ])("code=%s vatExempt=%s → %s", (code, exempt, expected) => {
    expect(
      resolveVatRate({
        countryCode: code as string | null,
        deliveryMode: "pickup",
        vatExempt: exempt as boolean,
      }),
    ).toBe(expected);
  });
});

describe("resolveVatRate — fusion (mode merge)", () => {
  it("hérite du taux 20 % de la commande parente", () => {
    expect(
      resolveVatRate({
        countryCode: "GP", // adresse DOM-TOM
        deliveryMode: "merge",
        vatExempt: false,
        parentTvaRate: 0.2,
      }),
    ).toBe(0.2);
  });

  it("hérite du taux 0 % de la commande parente", () => {
    expect(
      resolveVatRate({
        countryCode: "FR", // adresse FR
        deliveryMode: "merge",
        vatExempt: false,
        parentTvaRate: 0,
      }),
    ).toBe(0);
  });

  it("fallback 20 % si parentTvaRate manquant", () => {
    expect(
      resolveVatRate({
        countryCode: "FR",
        deliveryMode: "merge",
        vatExempt: false,
      }),
    ).toBe(0.2);
  });
});

describe("resolveVatRate — transporteur privé (mode private)", () => {
  describe("adresse DOM-TOM", () => {
    it("case NON cochée → 20 % FR par défaut (aucune preuve de sortie)", () => {
      expect(
        resolveVatRate({
          countryCode: "GP",
          deliveryMode: "private",
          vatExempt: false,
          domTomCertified: false,
        }),
      ).toBe(0.2);
    });

    it("case cochée → 0 % (attestation d'expédition DOM-TOM)", () => {
      expect(
        resolveVatRate({
          countryCode: "GP",
          deliveryMode: "private",
          vatExempt: false,
          domTomCertified: true,
        }),
      ).toBe(0);
    });

    it.each([["GP"], ["MQ"], ["GF"], ["YT"], ["RE"], ["NC"], ["PF"]])(
      "cas cochée pour %s → 0",
      (code) => {
        expect(
          resolveVatRate({
            countryCode: code,
            deliveryMode: "private",
            vatExempt: false,
            domTomCertified: true,
          }),
        ).toBe(0);
      },
    );
  });

  describe("adresse France métropolitaine", () => {
    it("20 % (règle standard, la case DOM-TOM n'a aucun effet)", () => {
      expect(
        resolveVatRate({
          countryCode: "FR",
          deliveryMode: "private",
          vatExempt: false,
          domTomCertified: true,
        }),
      ).toBe(0.2);
    });
  });

  describe("adresse UE hors France", () => {
    it("vatExempt=false → 20 %", () => {
      expect(
        resolveVatRate({
          countryCode: "DE",
          deliveryMode: "private",
          vatExempt: false,
        }),
      ).toBe(0.2);
    });

    it("vatExempt=true → 0 % (auto-liquidation intracom)", () => {
      expect(
        resolveVatRate({
          countryCode: "DE",
          deliveryMode: "private",
          vatExempt: true,
        }),
      ).toBe(0);
    });
  });
});

describe("resolveVatRate — livraison classique (mode delivery)", () => {
  it.each([
    ["FR", false, 0.2],
    ["FR", true, 0.2],
  ])("France métropole (%s, vatExempt=%s) → %s", (code, exempt, expected) => {
    expect(
      resolveVatRate({
        countryCode: code,
        deliveryMode: "delivery",
        vatExempt: exempt as boolean,
      }),
    ).toBe(expected);
  });

  it.each([["GP"], ["MQ"], ["GF"], ["YT"], ["RE"], ["NC"], ["PF"]])(
    "DOM-TOM (%s) → 0 %%",
    (code) => {
      expect(
        resolveVatRate({
          countryCode: code,
          deliveryMode: "delivery",
          vatExempt: false,
        }),
      ).toBe(0);
    },
  );

  it("UE non exonéré → 20 %", () => {
    expect(
      resolveVatRate({
        countryCode: "DE",
        deliveryMode: "delivery",
        vatExempt: false,
      }),
    ).toBe(0.2);
  });

  it("UE exonéré → 0 %", () => {
    expect(
      resolveVatRate({
        countryCode: "DE",
        deliveryMode: "delivery",
        vatExempt: true,
      }),
    ).toBe(0);
  });

  it("Hors UE → 0 %", () => {
    expect(
      resolveVatRate({
        countryCode: "US",
        deliveryMode: "delivery",
        vatExempt: false,
      }),
    ).toBe(0);
  });

  it("pays inconnu → 0 %", () => {
    expect(
      resolveVatRate({
        countryCode: null,
        deliveryMode: "delivery",
        vatExempt: false,
      }),
    ).toBe(0);
  });

  it("insensible à la casse", () => {
    expect(
      resolveVatRate({
        countryCode: "fr",
        deliveryMode: "delivery",
        vatExempt: false,
      }),
    ).toBe(0.2);
  });
});

describe("resolveVatRate — rétro-compat via isPickup", () => {
  it("isPickup=true sans deliveryMode → traité comme pickup", () => {
    expect(
      resolveVatRate({ countryCode: "GP", isPickup: true, vatExempt: false }),
    ).toBe(0.2);
  });

  it("isPickup=false sans deliveryMode → traité comme delivery", () => {
    expect(
      resolveVatRate({ countryCode: "GP", isPickup: false, vatExempt: false }),
    ).toBe(0);
  });
});

describe("buildDomTomCertificationLabel", () => {
  it("retourne le libellé pour la Guadeloupe", () => {
    expect(buildDomTomCertificationLabel("GP")).toBe(
      "Je certifie que mon colis sera livré en France (Guadeloupe) et que la commande sera exonérée de la TVA française métropolitaine.",
    );
  });

  it("retourne le libellé pour Martinique", () => {
    expect(buildDomTomCertificationLabel("MQ")).toContain("France (Martinique)");
  });

  it("null pour France métropole", () => {
    expect(buildDomTomCertificationLabel("FR")).toBeNull();
  });

  it("null pour un pays UE", () => {
    expect(buildDomTomCertificationLabel("DE")).toBeNull();
  });

  it("null pour null / undefined", () => {
    expect(buildDomTomCertificationLabel(null)).toBeNull();
    expect(buildDomTomCertificationLabel(undefined)).toBeNull();
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
