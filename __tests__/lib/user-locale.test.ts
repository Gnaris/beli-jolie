import { describe, it, expect } from "vitest";
import {
  resolveLocaleFromCountry,
  pickLocaleContent,
  DEFAULT_MAIL_LOCALE,
  type MailLocale,
} from "@/lib/user-locale";

describe("user-locale — resolveLocaleFromCountry", () => {
  it("France métropolitaine → fr", () => {
    expect(resolveLocaleFromCountry("FR")).toBe("fr");
  });

  it("insensible à la casse", () => {
    expect(resolveLocaleFromCountry("fr")).toBe("fr");
    expect(resolveLocaleFromCountry("Fr")).toBe("fr");
  });

  it("Belgique, Luxembourg, Monaco, Suisse, Andorre → fr", () => {
    expect(resolveLocaleFromCountry("BE")).toBe("fr");
    expect(resolveLocaleFromCountry("LU")).toBe("fr");
    expect(resolveLocaleFromCountry("MC")).toBe("fr");
    expect(resolveLocaleFromCountry("CH")).toBe("fr");
    expect(resolveLocaleFromCountry("AD")).toBe("fr");
  });

  it("DOM-TOM → fr", () => {
    for (const code of ["GP", "MQ", "GF", "RE", "YT", "PM", "BL", "MF", "WF", "PF", "NC", "TF"]) {
      expect(resolveLocaleFromCountry(code)).toBe("fr");
    }
  });

  it("Allemagne et Autriche → de", () => {
    expect(resolveLocaleFromCountry("DE")).toBe("de");
    expect(resolveLocaleFromCountry("AT")).toBe("de");
  });

  it("Espagne → es", () => {
    expect(resolveLocaleFromCountry("ES")).toBe("es");
  });

  it("Italie → it", () => {
    expect(resolveLocaleFromCountry("IT")).toBe("it");
  });

  it("tout autre pays → en (GB, US, NL, PT, SE…)", () => {
    for (const code of ["GB", "US", "NL", "PT", "SE", "IE", "DK", "FI", "PL"]) {
      expect(resolveLocaleFromCountry(code)).toBe("en");
    }
  });

  it("null / vide / undefined → défaut FR (compte sans adresse)", () => {
    expect(resolveLocaleFromCountry(null)).toBe(DEFAULT_MAIL_LOCALE);
    expect(resolveLocaleFromCountry(undefined)).toBe(DEFAULT_MAIL_LOCALE);
    expect(resolveLocaleFromCountry("")).toBe(DEFAULT_MAIL_LOCALE);
    expect(resolveLocaleFromCountry("   ")).toBe(DEFAULT_MAIL_LOCALE);
  });
});

describe("user-locale — pickLocaleContent (cascade de secours)", () => {
  const full = {
    fr: { subject: "FR sujet", html: "<p>FR</p>" },
    en: { subject: "EN sujet", html: "<p>EN</p>" },
    de: { subject: "DE sujet", html: "<p>DE</p>" },
  };

  it("renvoie la langue cible quand elle est remplie", () => {
    const res = pickLocaleContent(full, "de");
    expect(res?.locale).toBe("de");
    expect(res?.subject).toBe("DE sujet");
  });

  it("retombe sur EN quand la langue cible est vide", () => {
    const partial = {
      fr: { subject: "FR", html: "<p>FR</p>" },
      en: { subject: "EN", html: "<p>EN</p>" },
      it: { subject: "", html: "" },
    };
    const res = pickLocaleContent(partial, "it");
    expect(res?.locale).toBe("en");
  });

  it("retombe sur FR quand EN est aussi vide", () => {
    const partial = {
      fr: { subject: "FR", html: "<p>FR</p>" },
      en: { subject: "", html: null },
      es: { subject: "", html: "" },
    };
    const res = pickLocaleContent(partial, "es");
    expect(res?.locale).toBe("fr");
  });

  it("null quand toutes les versions sont vides", () => {
    const empty: Record<string, { subject: string; html: string | null }> = {
      fr: { subject: "", html: null },
      en: { subject: "", html: "" },
    };
    expect(pickLocaleContent(empty as Partial<Record<MailLocale, { subject: string; html: string | null }>>, "de")).toBeNull();
  });

  it("ne retourne que si subject ET html sont non vides", () => {
    const res = pickLocaleContent(
      {
        fr: { subject: "FR", html: "<p>FR</p>" },
        de: { subject: "DE sujet", html: "" }, // HTML vide → skip
      },
      "de",
    );
    expect(res?.locale).toBe("fr");
  });
});
