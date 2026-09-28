/**
 * Tests des helpers de normalisation de numéro téléphone utilisés par
 * PhoneContactIcons (colonne Société · Contact du tableau clients admin).
 *
 * WhatsApp attend un numéro international sans le `+` (E.164 sans le plus) :
 * ces tests garantissent qu'on couvre les 4 formats saisis en pratique par
 * la cliente (locale FR, +33, 0033, déjà international).
 */

import { describe, it, expect } from "vitest";

import {
  normalizePhoneDigits,
  toWhatsAppNumber,
  isLikelyFrenchLandline,
} from "@/components/admin/users/PhoneContactIcons";

describe("normalizePhoneDigits", () => {
  it("retire espaces, points, tirets et parenthèses", () => {
    expect(normalizePhoneDigits("06 12.34-56 (78)")).toBe("0612345678");
  });

  it("conserve le préfixe +", () => {
    expect(normalizePhoneDigits("+33 6 12 34 56 78")).toBe("+33612345678");
  });
});

describe("toWhatsAppNumber", () => {
  it("convertit un mobile FR local (0…) en 33…", () => {
    expect(toWhatsAppNumber("06 12 34 56 78")).toBe("33612345678");
  });

  it("accepte le format +33", () => {
    expect(toWhatsAppNumber("+33 6 12 34 56 78")).toBe("33612345678");
  });

  it("accepte le format 0033", () => {
    expect(toWhatsAppNumber("0033612345678")).toBe("33612345678");
  });

  it("accepte un numéro déjà en format international sans +", () => {
    expect(toWhatsAppNumber("33612345678")).toBe("33612345678");
  });

  it("retourne null pour un numéro vide", () => {
    expect(toWhatsAppNumber("")).toBeNull();
    expect(toWhatsAppNumber("   ")).toBeNull();
  });

  it("gère un numéro international non-français", () => {
    // Belgique +32 4 xx xx xx xx
    expect(toWhatsAppNumber("+32 470 12 34 56")).toBe("32470123456");
  });
});

describe("isLikelyFrenchLandline", () => {
  it("détecte les lignes fixes FR (01/02/03/04/05/09)", () => {
    expect(isLikelyFrenchLandline("01 42 34 56 78")).toBe(true);
    expect(isLikelyFrenchLandline("04 91 12 34 56")).toBe(true);
    expect(isLikelyFrenchLandline("09 70 12 34 56")).toBe(true);
  });

  it("détecte les lignes fixes FR en +33", () => {
    expect(isLikelyFrenchLandline("+33 1 42 34 56 78")).toBe(true);
    expect(isLikelyFrenchLandline("0033142345678")).toBe(true);
    expect(isLikelyFrenchLandline("33142345678")).toBe(true);
  });

  it("ne considère PAS un mobile FR comme fixe", () => {
    expect(isLikelyFrenchLandline("06 12 34 56 78")).toBe(false);
    expect(isLikelyFrenchLandline("07 82 75 81 58")).toBe(false);
    expect(isLikelyFrenchLandline("+33 6 12 34 56 78")).toBe(false);
  });

  it("ne considère pas les numéros étrangers comme fixes FR", () => {
    expect(isLikelyFrenchLandline("+32 470 12 34 56")).toBe(false);
    expect(isLikelyFrenchLandline("+1 415 555 1234")).toBe(false);
  });

  it("gère les entrées vides", () => {
    expect(isLikelyFrenchLandline("")).toBe(false);
  });
});
