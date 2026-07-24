import { describe, it, expect } from "vitest";
import {
  microstoreCountryToIso,
  microstoreMapStatus,
} from "@/lib/microstore-client";

describe("microstore-client — microstoreMapStatus", () => {
  it("shipping_status ≥ 2 = SHIPPED", () => {
    expect(microstoreMapStatus({ shippingStatus: "2" })).toBe("SHIPPED");
    expect(microstoreMapStatus({ shippingStatus: 2 })).toBe("SHIPPED");
    expect(microstoreMapStatus({ shippingStatus: 3 })).toBe("SHIPPED");
  });

  it("shipping_status 0 ou 1 = NEW (à préparer / partiel)", () => {
    expect(microstoreMapStatus({ shippingStatus: "0" })).toBe("NEW");
    expect(microstoreMapStatus({ shippingStatus: 0 })).toBe("NEW");
    expect(microstoreMapStatus({ shippingStatus: "1" })).toBe("NEW");
  });

  it("shipping_status invalide/manquant = NEW par défaut", () => {
    expect(microstoreMapStatus({ shippingStatus: "" })).toBe("NEW");
    expect(microstoreMapStatus({ shippingStatus: "abc" })).toBe("NEW");
  });
});

describe("microstore-client — microstoreCountryToIso", () => {
  it("passe les codes ISO alpha-2 tels quels (upper)", () => {
    expect(microstoreCountryToIso("FR")).toBe("FR");
    expect(microstoreCountryToIso("fr")).toBe("FR");
    expect(microstoreCountryToIso("BE")).toBe("BE");
  });

  it("convertit les noms de pays anglais courants", () => {
    expect(microstoreCountryToIso("FRANCE")).toBe("FR");
    expect(microstoreCountryToIso("BELGIUM")).toBe("BE");
    expect(microstoreCountryToIso("SPAIN")).toBe("ES");
    expect(microstoreCountryToIso("ITALY")).toBe("IT");
    expect(microstoreCountryToIso("SWITZERLAND")).toBe("CH");
  });

  it("convertit les noms de pays français courants", () => {
    expect(microstoreCountryToIso("BELGIQUE")).toBe("BE");
    expect(microstoreCountryToIso("SUISSE")).toBe("CH");
    expect(microstoreCountryToIso("ALLEMAGNE")).toBe("DE");
    expect(microstoreCountryToIso("Pays-Bas")).toBe("NL");
  });

  it("retourne null pour null / vide / inconnu", () => {
    expect(microstoreCountryToIso(null)).toBeNull();
    expect(microstoreCountryToIso(undefined)).toBeNull();
    expect(microstoreCountryToIso("")).toBeNull();
    expect(microstoreCountryToIso("   ")).toBeNull();
    expect(microstoreCountryToIso("KANATA")).toBeNull();
  });
});
