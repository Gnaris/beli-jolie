import { describe, it, expect } from "vitest";
import { getCompanyZone, COUNTRIES, DOM_TOM_COUNTRIES, EU_COUNTRIES } from "@/lib/vat";

describe("getCompanyZone — zone administrative de l'inscription B2B", () => {
  it("classe France métropolitaine en zone FR", () => {
    expect(getCompanyZone("FR")).toBe("FR");
    expect(getCompanyZone("fr")).toBe("FR");
  });

  it("classe tous les DOM-TOM en zone FR (même régime SIRET/Kbis)", () => {
    for (const code of DOM_TOM_COUNTRIES) {
      expect(getCompanyZone(code)).toBe("FR");
    }
  });

  it("classe les États membres UE (hors France) en zone EU", () => {
    for (const code of EU_COUNTRIES) {
      if (code === "FR") continue;
      expect(getCompanyZone(code)).toBe("EU");
    }
  });

  it("classe le reste du monde en zone WORLD", () => {
    expect(getCompanyZone("US")).toBe("WORLD");
    expect(getCompanyZone("CN")).toBe("WORLD");
    expect(getCompanyZone("GB")).toBe("WORLD");
    expect(getCompanyZone("CH")).toBe("WORLD");
    expect(getCompanyZone("MC")).toBe("WORLD");
  });

  it("classe une valeur vide/inconnue en zone WORLD (fallback safe)", () => {
    expect(getCompanyZone(null)).toBe("WORLD");
    expect(getCompanyZone(undefined)).toBe("WORLD");
    expect(getCompanyZone("")).toBe("WORLD");
    expect(getCompanyZone("ZZ")).toBe("WORLD");
  });
});

describe("Liste des pays — libellés France (…)", () => {
  it("France Métropole apparaît en tête avec le libellé « France (Métropole) »", () => {
    expect(COUNTRIES[0]).toMatchObject({ code: "FR", name: "France (Métropole)" });
  });

  it("chaque DOM-TOM est libellé « France (…) »", () => {
    const french = COUNTRIES.filter((c) => c.code === "FR" || DOM_TOM_COUNTRIES.has(c.code));
    for (const c of french) {
      expect(c.name).toMatch(/^France \(/);
    }
  });

  it("tous les codes ISO-2 sont présents et uniques", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("les 12 codes DOM-TOM ont bien une entrée dans COUNTRIES", () => {
    for (const code of DOM_TOM_COUNTRIES) {
      expect(COUNTRIES.find((c) => c.code === code)).toBeTruthy();
    }
  });
});
