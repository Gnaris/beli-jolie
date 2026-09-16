import { describe, it, expect } from "vitest";
import {
  formatIbanForDisplay,
  normalizeIban,
  isPlausibleIban,
} from "@/lib/bank-transfer-config";

describe("normalizeIban", () => {
  it("retire les espaces et met en majuscules", () => {
    expect(normalizeIban("fr76 3000 4028 3700 0123 4567 890")).toBe(
      "FR7630004028370001234567890",
    );
  });

  it("laisse un IBAN déjà propre inchangé (hors casse)", () => {
    expect(normalizeIban("FR7630004028370001234567890")).toBe(
      "FR7630004028370001234567890",
    );
  });
});

describe("formatIbanForDisplay", () => {
  it("découpe en groupes de 4 caractères séparés par des espaces", () => {
    expect(formatIbanForDisplay("FR7630004028370001234567890")).toBe(
      "FR76 3000 4028 3700 0123 4567 890",
    );
  });

  it("normalise l'entrée avant formatage", () => {
    expect(formatIbanForDisplay("fr76 3000 4028 3700 0123 4567 890")).toBe(
      "FR76 3000 4028 3700 0123 4567 890",
    );
  });

  it("retourne une chaîne vide pour une entrée vide", () => {
    expect(formatIbanForDisplay("")).toBe("");
  });
});

describe("isPlausibleIban", () => {
  it("accepte un IBAN FR standard", () => {
    expect(isPlausibleIban("FR7630004028370001234567890")).toBe(true);
    expect(isPlausibleIban("FR76 3000 4028 3700 0123 4567 890")).toBe(true);
  });

  it("accepte un IBAN BE (12 caractères)", () => {
    expect(isPlausibleIban("BE68539007547034")).toBe(true);
  });

  it("refuse une entrée trop courte", () => {
    expect(isPlausibleIban("FR76")).toBe(false);
    expect(isPlausibleIban("FR7630004028")).toBe(false);
  });

  it("refuse une entrée sans code pays valide", () => {
    expect(isPlausibleIban("7630004028370001234567890")).toBe(false);
    expect(isPlausibleIban("XX99")).toBe(false);
  });

  it("refuse une entrée avec des caractères non alphanum", () => {
    expect(isPlausibleIban("FR76-3000-4028-3700-0123-4567-890")).toBe(false);
  });
});
