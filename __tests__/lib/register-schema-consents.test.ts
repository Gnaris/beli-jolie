/**
 * Tests pour lib/validations/auth.ts — Consentements (CGU + newsletter)
 *
 * Contexte : le wizard d'inscription impose une case CGU obligatoire (acceptsTerms)
 * et propose une case newsletter facultative (acceptsNewsletter). La case
 * newsletter couvre newsletter + relances panier abandonné (RGPD strict).
 */
import { describe, it, expect } from "vitest";
import { registerSchema } from "@/lib/validations/auth";

const baseFields = {
  firstName: "Jean",
  lastName: "Dupont",
  company: "Acme SARL",
  email: "jean@acme.fr",
  phone: "0612345678",
  addressStreet: "12 rue des Lilas",
  addressZip: "75011",
  addressCity: "Paris",
  addressCountry: "FR",
  password: "Passw0rdX",
  confirmPassword: "Passw0rdX",
};

describe("registerSchema — acceptsTerms (CGU obligatoire)", () => {
  it("refuse une inscription sans acceptsTerms", () => {
    const result = registerSchema.safeParse({ ...baseFields });
    expect(result.success).toBe(false);
    if (!result.success) {
      const termsIssue = result.error.issues.find((i) => i.path[0] === "acceptsTerms");
      expect(termsIssue).toBeDefined();
    }
  });

  it("refuse une inscription avec acceptsTerms=false", () => {
    const result = registerSchema.safeParse({ ...baseFields, acceptsTerms: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      const termsIssue = result.error.issues.find((i) => i.path[0] === "acceptsTerms");
      expect(termsIssue?.message).toContain("CGU");
    }
  });

  it("accepte une inscription avec acceptsTerms=true", () => {
    const result = registerSchema.safeParse({ ...baseFields, acceptsTerms: true });
    expect(result.success).toBe(true);
  });
});

describe("registerSchema — acceptsNewsletter (facultatif)", () => {
  it("par défaut acceptsNewsletter vaut false quand omis", () => {
    const result = registerSchema.safeParse({ ...baseFields, acceptsTerms: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acceptsNewsletter).toBe(false);
    }
  });

  it("accepte acceptsNewsletter=true explicite", () => {
    const result = registerSchema.safeParse({
      ...baseFields,
      acceptsTerms: true,
      acceptsNewsletter: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acceptsNewsletter).toBe(true);
    }
  });

  it("accepte acceptsNewsletter=false explicite", () => {
    const result = registerSchema.safeParse({
      ...baseFields,
      acceptsTerms: true,
      acceptsNewsletter: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.acceptsNewsletter).toBe(false);
    }
  });
});
