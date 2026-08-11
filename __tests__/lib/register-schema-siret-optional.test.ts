/**
 * Tests pour lib/validations/auth.ts — SIRET facultatif
 *
 * Contexte : depuis 2026-08-11, le SIRET est optionnel à l'inscription pour
 * accepter les clients étrangers qui n'en ont pas.
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

describe("registerSchema — SIRET facultatif", () => {
  it("accepte une inscription sans SIRET (client hors France)", () => {
    const result = registerSchema.safeParse({
      ...baseFields,
      addressCountry: "DE",
      siret: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepte une inscription sans le champ SIRET du tout", () => {
    const result = registerSchema.safeParse({ ...baseFields });
    expect(result.success).toBe(true);
  });

  it("accepte un SIRET valide à 14 chiffres", () => {
    const result = registerSchema.safeParse({ ...baseFields, siret: "12345678901234" });
    expect(result.success).toBe(true);
  });

  it("refuse un SIRET mal formaté quand il est présent", () => {
    const result = registerSchema.safeParse({ ...baseFields, siret: "123" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("14 chiffres");
    }
  });

  it("refuse un SIRET contenant des lettres", () => {
    const result = registerSchema.safeParse({ ...baseFields, siret: "1234567890ABCD" });
    expect(result.success).toBe(false);
  });
});
