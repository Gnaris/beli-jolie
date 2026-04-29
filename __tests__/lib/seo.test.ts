/**
 * Tests for lib/seo.ts
 * Pure helpers building SEO metadata (alternates, JSON-LD Organization & WebSite).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  absoluteUrl,
  buildAlternates,
  buildOrganizationSchema,
  buildWebsiteSchema,
  getSiteUrl,
} from "@/lib/seo";
import { VALID_LOCALES } from "@/i18n/locales";

describe("lib/seo", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_URL = "https://shop.example.com";
  });

  describe("getSiteUrl", () => {
    it("returns NEXTAUTH_URL without trailing slash", () => {
      process.env.NEXTAUTH_URL = "https://shop.example.com/";
      expect(getSiteUrl()).toBe("https://shop.example.com");
    });

    it("falls back to placeholder when NEXTAUTH_URL is missing", () => {
      delete process.env.NEXTAUTH_URL;
      expect(getSiteUrl()).toBe("https://example.com");
    });
  });

  describe("absoluteUrl", () => {
    it("prepends base for paths starting with /", () => {
      expect(absoluteUrl("/produits/123")).toBe("https://shop.example.com/produits/123");
    });

    it("inserts a slash when path is missing one", () => {
      expect(absoluteUrl("produits")).toBe("https://shop.example.com/produits");
    });
  });

  describe("buildAlternates", () => {
    it("canonical reflects the locale of the current page", () => {
      const altsFr = buildAlternates("/produits/abc", "fr");
      expect(altsFr.canonical).toBe("https://shop.example.com/fr/produits/abc");
      const altsEn = buildAlternates("/produits/abc", "en");
      expect(altsEn.canonical).toBe("https://shop.example.com/en/produits/abc");
    });

    it("x-default points to the French version", () => {
      const alts = buildAlternates("/", "en");
      expect(alts.languages["x-default"]).toBe("https://shop.example.com/fr");
    });

    it("emits one alternate per supported locale", () => {
      const alts = buildAlternates("/produits/abc", "fr");
      for (const locale of VALID_LOCALES) {
        expect(alts.languages[locale]).toBe(`https://shop.example.com/${locale}/produits/abc`);
      }
    });

    it("handles the home path correctly (no double slash)", () => {
      const alts = buildAlternates("/", "fr");
      expect(alts.canonical).toBe("https://shop.example.com/fr");
      expect(alts.languages.fr).toBe("https://shop.example.com/fr");
    });

    it("uses 'fr' as default locale when none is provided", () => {
      const alts = buildAlternates("/produits");
      expect(alts.canonical).toBe("https://shop.example.com/fr/produits");
    });
  });

  describe("buildOrganizationSchema", () => {
    it("emits the minimum required fields", () => {
      const schema = buildOrganizationSchema({
        name: "Beli Jolie",
        url: "https://shop.example.com",
        description: "Grossiste B2B",
      });
      expect(schema["@context"]).toBe("https://schema.org");
      expect(schema["@type"]).toBe("Organization");
      expect(schema.name).toBe("Beli Jolie");
      expect(schema.url).toBe("https://shop.example.com");
      expect(schema.description).toBe("Grossiste B2B");
      expect(schema.contactPoint).toBeUndefined();
      expect(schema.address).toBeUndefined();
    });

    it("builds a contactPoint when email or phone is provided", () => {
      const schema = buildOrganizationSchema({
        name: "X",
        url: "https://x.com",
        description: "d",
        email: "support@x.com",
        phone: "+33 1 23 45 67 89",
      });
      expect(schema.contactPoint).toEqual({
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "support@x.com",
        telephone: "+33 1 23 45 67 89",
      });
    });

    it("emits a PostalAddress when city or street is provided", () => {
      const schema = buildOrganizationSchema({
        name: "X",
        url: "https://x.com",
        description: "d",
        address: { street: "1 rue Test", city: "Paris", postalCode: "75001", country: "France" },
      });
      expect(schema.address).toEqual({
        "@type": "PostalAddress",
        streetAddress: "1 rue Test",
        addressLocality: "Paris",
        postalCode: "75001",
        addressCountry: "France",
      });
    });
  });

  describe("buildWebsiteSchema", () => {
    it("emits a SearchAction targeting /produits", () => {
      const schema = buildWebsiteSchema({ name: "X", url: "https://x.com" });
      expect(schema["@type"]).toBe("WebSite");
      expect(schema.name).toBe("X");
      expect(schema.url).toBe("https://x.com");
      expect(schema.potentialAction).toEqual({
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "https://x.com/produits?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      });
    });
  });
});
