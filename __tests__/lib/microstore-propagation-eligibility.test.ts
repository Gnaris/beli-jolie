import { describe, it, expect } from "vitest";
import { isMicrostorePropagationEligible } from "@/lib/microstore-propagation-eligibility";

describe("isMicrostorePropagationEligible", () => {
  it("accepte un produit complet dont Microstore est activé", () => {
    expect(
      isMicrostorePropagationEligible({
        microstoreEnabled: true,
        isIncomplete: false,
      }),
    ).toBe(true);
  });

  it("refuse un brouillon même si Microstore est activé (garde principal)", () => {
    expect(
      isMicrostorePropagationEligible({
        microstoreEnabled: true,
        isIncomplete: true,
      }),
    ).toBe(false);
  });

  it("refuse un produit complet dont Microstore est désactivé", () => {
    expect(
      isMicrostorePropagationEligible({
        microstoreEnabled: false,
        isIncomplete: false,
      }),
    ).toBe(false);
  });

  it("refuse quand microstoreEnabled est absent (défensif)", () => {
    expect(isMicrostorePropagationEligible({ isIncomplete: false })).toBe(false);
  });
});
