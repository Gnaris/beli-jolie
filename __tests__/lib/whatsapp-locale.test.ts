/**
 * Tests du résolveur de locale WhatsApp — décide FR/EN/DE/IT/ES à partir
 * du pays ISO-2 du destinataire, et choisit le corps à envoyer avec un
 * fallback en cascade (locale cible → EN → FR).
 */

import { describe, it, expect } from "vitest";
import {
  resolveWhatsAppLocale,
  pickWhatsAppBody,
  FRANCOPHONE_COUNTRY_CODES,
  GERMANOPHONE_COUNTRY_CODES,
  ITALOPHONE_COUNTRY_CODES,
  HISPANOPHONE_COUNTRY_CODES,
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

  it("retourne 'fr' pour BE/CH/LU/MC (choix cliente — même si multilingues)", () => {
    expect(resolveWhatsAppLocale("BE")).toBe("fr");
    expect(resolveWhatsAppLocale("CH")).toBe("fr");
    expect(resolveWhatsAppLocale("LU")).toBe("fr");
    expect(resolveWhatsAppLocale("MC")).toBe("fr");
  });

  it("retourne 'de' pour l'Allemagne et l'Autriche", () => {
    expect(resolveWhatsAppLocale("DE")).toBe("de");
    expect(resolveWhatsAppLocale("AT")).toBe("de");
    expect(resolveWhatsAppLocale("at")).toBe("de"); // insensible casse
  });

  it("retourne 'it' pour l'Italie et ses enclaves", () => {
    expect(resolveWhatsAppLocale("IT")).toBe("it");
    expect(resolveWhatsAppLocale("SM")).toBe("it");
    expect(resolveWhatsAppLocale("VA")).toBe("it");
  });

  it("retourne 'es' pour l'Espagne et l'Amérique latine hispanophone", () => {
    expect(resolveWhatsAppLocale("ES")).toBe("es");
    expect(resolveWhatsAppLocale("MX")).toBe("es");
    expect(resolveWhatsAppLocale("AR")).toBe("es");
    expect(resolveWhatsAppLocale("CO")).toBe("es");
    expect(resolveWhatsAppLocale("CL")).toBe("es");
    expect(resolveWhatsAppLocale("PE")).toBe("es");
  });

  it("retourne 'en' pour les pays hors des zones ciblées", () => {
    expect(resolveWhatsAppLocale("US")).toBe("en");
    expect(resolveWhatsAppLocale("GB")).toBe("en");
    expect(resolveWhatsAppLocale("BR")).toBe("en"); // portugais → fallback EN
    expect(resolveWhatsAppLocale("JP")).toBe("en");
    expect(resolveWhatsAppLocale("NL")).toBe("en");
  });

  it("gère les espaces + casse mixte", () => {
    expect(resolveWhatsAppLocale("  fr  ")).toBe("fr");
    expect(resolveWhatsAppLocale("Us")).toBe("en");
    expect(resolveWhatsAppLocale(" de ")).toBe("de");
  });

  it("ne contient pas de doublons dans les listes", () => {
    // Set : test automatiquement dédoublonné, on vérifie la cardinalité
    // comme garde-fou contre un futur doublon accidentel.
    expect(FRANCOPHONE_COUNTRY_CODES.size).toBe(17);
    expect(GERMANOPHONE_COUNTRY_CODES.size).toBe(2);
    expect(ITALOPHONE_COUNTRY_CODES.size).toBe(3);
    expect(HISPANOPHONE_COUNTRY_CODES.size).toBe(21);
  });

  it("les 4 zones linguistiques ne se chevauchent pas", () => {
    const all = [
      ...FRANCOPHONE_COUNTRY_CODES,
      ...GERMANOPHONE_COUNTRY_CODES,
      ...ITALOPHONE_COUNTRY_CODES,
      ...HISPANOPHONE_COUNTRY_CODES,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("pickWhatsAppBody", () => {
  it("choisit la locale ciblée si son body est présent", () => {
    const res = pickWhatsAppBody({
      locale: "de",
      bodyFr: "Bonjour",
      bodyEn: "Hello",
      bodyDe: "Hallo",
      bodyIt: "Ciao",
      bodyEs: "Hola",
    });
    expect(res).toEqual({ body: "Hallo", sentLocale: "de" });
  });

  it("retombe sur EN quand la locale ciblée est vide", () => {
    const res = pickWhatsAppBody({
      locale: "de",
      bodyFr: "Bonjour",
      bodyEn: "Hello",
      bodyDe: "", // vide
    });
    expect(res).toEqual({ body: "Hello", sentLocale: "en" });
  });

  it("retombe sur EN quand la locale ciblée est null", () => {
    const res = pickWhatsAppBody({
      locale: "it",
      bodyFr: "Bonjour",
      bodyEn: "Hello",
      bodyIt: null,
    });
    expect(res).toEqual({ body: "Hello", sentLocale: "en" });
  });

  it("retombe sur FR quand ni la locale ciblée ni EN ne sont présents", () => {
    const res = pickWhatsAppBody({
      locale: "es",
      bodyFr: "Bonjour",
      bodyEn: null,
      bodyEs: "",
    });
    expect(res).toEqual({ body: "Bonjour", sentLocale: "fr" });
  });

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

  it("choisit toujours FR quand la locale est 'fr' même avec autres bodies dispo", () => {
    const res = pickWhatsAppBody({
      locale: "fr",
      bodyFr: "Bonjour",
      bodyEn: "Hello",
      bodyDe: "Hallo",
    });
    expect(res).toEqual({ body: "Bonjour", sentLocale: "fr" });
  });

  it("ne confond pas une version espaces-seulement avec un contenu valide", () => {
    const res = pickWhatsAppBody({
      locale: "it",
      bodyFr: "Bonjour",
      bodyEn: "Hello",
      bodyIt: "   \n  ",
    });
    expect(res).toEqual({ body: "Hello", sentLocale: "en" });
  });
});
