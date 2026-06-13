import { describe, it, expect } from "vitest";
import { alpha2ToAlpha3, resolveFaireCountry } from "@/lib/faire-country";

describe("alpha2ToAlpha3", () => {
  it("convertit les codes courants", () => {
    expect(alpha2ToAlpha3("CN")).toBe("CHN");
    expect(alpha2ToAlpha3("FR")).toBe("FRA");
    expect(alpha2ToAlpha3("PT")).toBe("PRT");
    expect(alpha2ToAlpha3("IT")).toBe("ITA");
    expect(alpha2ToAlpha3("US")).toBe("USA");
  });

  it("accepte minuscules et avec espaces", () => {
    expect(alpha2ToAlpha3("  cn  ")).toBe("CHN");
    expect(alpha2ToAlpha3("fr")).toBe("FRA");
  });

  it("retourne null pour null/undefined/vide", () => {
    expect(alpha2ToAlpha3(null)).toBeNull();
    expect(alpha2ToAlpha3(undefined)).toBeNull();
    expect(alpha2ToAlpha3("")).toBeNull();
  });

  it("retourne null pour un code inconnu", () => {
    expect(alpha2ToAlpha3("XX")).toBeNull();
    expect(alpha2ToAlpha3("ZZ")).toBeNull();
  });

  it("accepte directement un alpha-3 valide", () => {
    expect(alpha2ToAlpha3("CHN")).toBe("CHN");
    expect(alpha2ToAlpha3("FRA")).toBe("FRA");
  });

  it("rejette un alpha-3 invalide (chiffres etc)", () => {
    expect(alpha2ToAlpha3("CN1")).toBeNull();
    expect(alpha2ToAlpha3("AB1")).toBeNull();
  });
});

describe("resolveFaireCountry", () => {
  it("convertit alpha-2 connu", () => {
    expect(resolveFaireCountry("CN")).toBe("CHN");
  });

  it("retombe sur CHN par défaut si inconnu", () => {
    expect(resolveFaireCountry(null)).toBe("CHN");
    expect(resolveFaireCountry("XX")).toBe("CHN");
  });

  it("permet de surcharger le fallback", () => {
    expect(resolveFaireCountry(null, "FRA")).toBe("FRA");
    expect(resolveFaireCountry("XX", "USA")).toBe("USA");
  });
});
