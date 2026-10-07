import { describe, it, expect } from "vitest";
import {
  VALID_LOCALES,
  DEFAULT_LOCALE,
  NON_DEFAULT_LOCALES,
  AUTO_TRANSLATE_LOCALES,
  LOCALE_LABELS,
  LOCALE_FULL_NAMES,
} from "@/i18n/locales";

describe("i18n/locales", () => {
  it("exposes fr/en/de/it/es as valid locales", () => {
    expect([...VALID_LOCALES]).toEqual(["fr", "en", "de", "it", "es"]);
  });

  it("defaults to fr", () => {
    expect(DEFAULT_LOCALE).toBe("fr");
  });

  it("NON_DEFAULT_LOCALES omits fr and keeps the four others in order", () => {
    expect(NON_DEFAULT_LOCALES).toEqual(["en", "de", "it", "es"]);
  });

  it("AUTO_TRANSLATE_LOCALES is restricted to en to avoid spamming PFS on entity creation", () => {
    // Garde-fou volontaire : l'auto-traduction fire-and-forget ne doit cibler
    // QUE l'anglais. DE/IT/ES passent par les boutons « Traduire » manuels.
    expect(AUTO_TRANSLATE_LOCALES).toEqual(["en"]);
  });

  it("provides a short label and a full French name for each locale", () => {
    for (const locale of VALID_LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
      expect(LOCALE_FULL_NAMES[locale]).toBeTruthy();
    }
  });
});
