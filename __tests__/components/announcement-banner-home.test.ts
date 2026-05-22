import { describe, it, expect } from "vitest";
import { stripLocalePrefix } from "@/lib/locale-path";

// AnnouncementBanner masque le bandeau partout sauf sur la page d'accueil.
// La détection s'appuie sur stripLocalePrefix(pathname) === "/" pour fonctionner
// avec les URLs préfixées par locale (/fr, /en) introduites par next-intl.
function isHome(pathname: string): boolean {
  return stripLocalePrefix(pathname) === "/";
}

describe("AnnouncementBanner — détection de la page d'accueil", () => {
  it("affiche le bandeau sur la home racine /", () => {
    expect(isHome("/")).toBe(true);
  });

  it("affiche le bandeau sur la home /fr (avec ou sans slash final)", () => {
    expect(isHome("/fr")).toBe(true);
    expect(isHome("/fr/")).toBe(true);
  });

  it("affiche le bandeau sur la home /en (avec ou sans slash final)", () => {
    expect(isHome("/en")).toBe(true);
    expect(isHome("/en/")).toBe(true);
  });

  it("masque le bandeau sur les pages internes localisées", () => {
    expect(isHome("/fr/produits")).toBe(false);
    expect(isHome("/fr/produits/123")).toBe(false);
    expect(isHome("/en/collections/print-2026")).toBe(false);
    expect(isHome("/fr/categories")).toBe(false);
  });

  it("masque le bandeau sur les pages admin et espace-pro", () => {
    expect(isHome("/admin")).toBe(false);
    expect(isHome("/admin/produits")).toBe(false);
    expect(isHome("/fr/espace-pro")).toBe(false);
  });

  it("ne confond pas un segment qui commence par une locale (ex: /freshly)", () => {
    expect(isHome("/freshly")).toBe(false);
    expect(isHome("/enquetes")).toBe(false);
  });
});
