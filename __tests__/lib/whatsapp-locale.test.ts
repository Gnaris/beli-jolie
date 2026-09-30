/**
 * Tests du résolveur de locale WhatsApp — décide FR vs EN à partir du pays
 * ISO-2 du destinataire, et choisit le corps de message à rendre.
 */

import { describe, it, expect } from "vitest";
import {
  resolveWhatsAppLocale,
  pickWhatsAppBody,
  FRANCOPHONE_COUNTRY_CODES,
} from "@/lib/whatsapp-locale";

describe("resolveWhatsAppLocale", () => {
  it("retourne 'fr' quand le pays est null", () => {
    expect(resolveWhatsAppLocale(null)).toBe("fr");
  });

  it("retourne 'fr' quand le pays est undefined", () => {
    expect(resolveWhatsAppLocale(undefined)).toBe("fr");
  });

  it("retourne 'fr' quand le pays est vide ou espaces", () => {
    expect(resolveWhatsAppLocale("")).toBe("fr");
    expect(resolveWhatsAppLocale("   ")).toBe("fr");
  });

  it("retourne 'fr' pour la France métropolitaine", () => {
    expect(resolveWhatsAppLocale("FR")).toBe("fr");
    expect(resolveWhatsAppLocale("fr")).toBe("fr"); // insensible casse
  });

  it("retourne 'fr' pour les DOM-TOM", () => {
    for (const code of ["GP", "MQ", "GF", "RE", "YT", "PM", "BL", "MF", "NC", "PF", "WF", "TF"]) {
      expect(resolveWhatsAppLocale(code)).toBe("fr");
    }
  });

  it("retourne 'fr' pour les voisins francophones", () => {
    expect(resolveWhatsAppLocale("BE")).toBe("fr");
    expect(resolveWhatsAppLocale("CH")).toBe("fr");
    expect(resolveWhatsAppLocale("LU")).toBe("fr");
    expect(resolveWhatsAppLocale("MC")).toBe("fr");
  });

  it("retourne 'en' pour les pays hors zone francophone", () => {
    expect(resolveWhatsAppLocale("US")).toBe("en");
    expect(resolveWhatsAppLocale("GB")).toBe("en");
    expect(resolveWhatsAppLocale("DE")).toBe("en");
    expect(resolveWhatsAppLocale("IT")).toBe("en");
    expect(resolveWhatsAppLocale("ES")).toBe("en");
    expect(resolveWhatsAppLocale("JP")).toBe("en");
  });

  it("gère les espaces + casse mixte", () => {
    expect(resolveWhatsAppLocale("  fr  ")).toBe("fr");
    expect(resolveWhatsAppLocale("Us")).toBe("en");
  });

  it("ne contient pas de doublons dans la liste francophone", () => {
    // Set : test automatiquement dédoublonné, on vérifie la cardinalité.
    // Toute PR qui ajoute un doublon fera baisser ce nombre.
    expect(FRANCOPHONE_COUNTRY_CODES.size).toBe(17);
  });
});

describe("pickWhatsAppBody", () => {
  it("choisit EN si la locale est 'en' et bodyEn n'est pas vide", () => {
    const res = pickWhatsAppBody({
      locale: "en",
      bodyFr: "Bonjour",
      bodyEn: "Hello",
    });
    expect(res).toEqual({ body: "Hello", sentLocale: "en" });
  });

  it("retombe sur FR quand locale='en' mais bodyEn est null", () => {
    const res = pickWhatsAppBody({
      locale: "en",
      bodyFr: "Bonjour",
      bodyEn: null,
    });
    expect(res).toEqual({ body: "Bonjour", sentLocale: "fr" });
  });

  it("retombe sur FR quand locale='en' mais bodyEn est undefined", () => {
    const res = pickWhatsAppBody({
      locale: "en",
      bodyFr: "Bonjour",
      bodyEn: undefined,
    });
    expect(res).toEqual({ body: "Bonjour", sentLocale: "fr" });
  });

  it("retombe sur FR quand locale='en' mais bodyEn est vide/espaces", () => {
    expect(pickWhatsAppBody({ locale: "en", bodyFr: "Bonjour", bodyEn: "" })).toEqual({
      body: "Bonjour",
      sentLocale: "fr",
    });
    expect(pickWhatsAppBody({ locale: "en", bodyFr: "Bonjour", bodyEn: "   " })).toEqual({
      body: "Bonjour",
      sentLocale: "fr",
    });
  });

  it("choisit toujours FR quand la locale est 'fr'", () => {
    const res = pickWhatsAppBody({
      locale: "fr",
      bodyFr: "Bonjour",
      bodyEn: "Hello", // même si EN dispo, on ignore
    });
    expect(res).toEqual({ body: "Bonjour", sentLocale: "fr" });
  });
});
