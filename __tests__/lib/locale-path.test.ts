import { describe, it, expect } from "vitest";
import { stripLocalePrefix, detectLocaleInPath } from "@/lib/locale-path";

describe("stripLocalePrefix", () => {
  it("retire /fr en début de chemin", () => {
    expect(stripLocalePrefix("/fr/produits")).toBe("/produits");
    expect(stripLocalePrefix("/fr/produits/abc-123")).toBe("/produits/abc-123");
  });

  it("retire /en en début de chemin", () => {
    expect(stripLocalePrefix("/en/produits")).toBe("/produits");
    expect(stripLocalePrefix("/en/collections/print-2026")).toBe("/collections/print-2026");
  });

  it("renvoie / quand le chemin est seulement la locale", () => {
    expect(stripLocalePrefix("/fr")).toBe("/");
    expect(stripLocalePrefix("/en")).toBe("/");
  });

  it("ne touche pas un chemin sans préfixe locale", () => {
    expect(stripLocalePrefix("/produits")).toBe("/produits");
    expect(stripLocalePrefix("/")).toBe("/");
  });

  it("ne strippe pas un segment qui ressemble à une locale (ex: /freshly)", () => {
    expect(stripLocalePrefix("/freshly")).toBe("/freshly");
    expect(stripLocalePrefix("/enquetes")).toBe("/enquetes");
  });

  it("est idempotent (préfixe déjà retiré)", () => {
    const stripped = stripLocalePrefix("/en/produits");
    expect(stripLocalePrefix(stripped)).toBe("/produits");
  });
});

describe("detectLocaleInPath", () => {
  it("détecte fr et en en début d'URL", () => {
    expect(detectLocaleInPath("/fr/produits")).toBe("fr");
    expect(detectLocaleInPath("/en/produits")).toBe("en");
    expect(detectLocaleInPath("/fr")).toBe("fr");
    expect(detectLocaleInPath("/en")).toBe("en");
  });

  it("retourne null si aucune locale détectée", () => {
    expect(detectLocaleInPath("/produits")).toBeNull();
    expect(detectLocaleInPath("/")).toBeNull();
    expect(detectLocaleInPath("/freshly")).toBeNull();
  });
});
