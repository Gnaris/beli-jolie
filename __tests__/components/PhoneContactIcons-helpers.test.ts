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
  computeMenuPosition,
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

describe("computeMenuPosition", () => {
  // Menu WhatsApp = 288 px (w-72 Tailwind). On teste surtout le comportement
  // sur viewport mobile étroit, où un ancrage « right » naïf fait déborder le
  // menu hors écran à gauche (bug admin/commandes/[id] en format téléphone).
  const MENU = 288;

  it("mobile étroit — bouton pas tout contre le bord droit : le menu reste à l'écran", () => {
    // iPhone SE : viewport 375 px. Bouton (28 px) à l'intérieur d'une carte,
    // bord droit à 180 px → ancrage right-aligned donnerait left = -108 (hors écran).
    const pos = computeMenuPosition({
      rect: { top: 100, bottom: 128, left: 152, right: 180 },
      viewportWidth: 375,
      menuWidth: MENU,
    });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + MENU).toBeLessThanOrEqual(375 - 8);
  });

  it("bouton proche du bord droit : menu aligné à droite du trigger", () => {
    // Desktop 1440 px, bouton à droite (rect.right = 1400) : menu reste
    // right-aligned → left = 1400 - 288 = 1112.
    const pos = computeMenuPosition({
      rect: { top: 100, bottom: 128, left: 1372, right: 1400 },
      viewportWidth: 1440,
      menuWidth: MENU,
    });
    expect(pos.left).toBe(1400 - MENU);
  });

  it("top = bas du trigger + 4 px (gap visuel)", () => {
    const pos = computeMenuPosition({
      rect: { top: 100, bottom: 128, left: 1372, right: 1400 },
      viewportWidth: 1440,
      menuWidth: MENU,
    });
    expect(pos.top).toBe(132);
  });

  it("mobile très étroit — menu plus large que viewport : clamp sur margin de gauche", () => {
    // Cas pathologique : viewport 320 px, menu 288 px → maxLeft = 320 - 288 - 8 = 24.
    const pos = computeMenuPosition({
      rect: { top: 50, bottom: 78, left: 280, right: 308 },
      viewportWidth: 320,
      menuWidth: MENU,
    });
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left).toBeLessThanOrEqual(24);
  });

  it("respecte une marge custom", () => {
    const pos = computeMenuPosition({
      rect: { top: 50, bottom: 78, left: 10, right: 38 },
      viewportWidth: 375,
      menuWidth: MENU,
      margin: 16,
    });
    expect(pos.left).toBeGreaterThanOrEqual(16);
  });
});
