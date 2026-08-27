import { describe, it, expect } from "vitest";
import { registerSchema } from "@/lib/validations/auth";

/**
 * Ces tests garantissent que le schéma Zod impose bien les règles
 * conditionnelles selon la zone administrative du pays saisi :
 *   - Zone FR (métropole + DOM-TOM) : SIRET obligatoire.
 *   - Zone EU (hors FR)             : TVA intracom obligatoire.
 *   - Zone WORLD                    : aucun champ texte supplémentaire
 *     (le justificatif est vérifié côté route.ts car FormData).
 */

const BASE = {
  firstName: "Marie",
  lastName: "Dupont",
  company: "Ma Société SARL",
  email: "contact@ma-societe.fr",
  phone: "0612345678",
  addressStreet: "12 rue des Lilas",
  addressComplement: "",
  addressZip: "75011",
  addressCity: "Paris",
  password: "Password1",
  confirmPassword: "Password1",
  acceptsTerms: true as const,
  registrationMessage: "",
};

function issuesFor(input: Record<string, unknown>) {
  const result = registerSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}

describe("registerSchema — zone France", () => {
  it("rejette une société FR sans SIRET", () => {
    const issues = issuesFor({ ...BASE, addressCountry: "FR", siret: "", vatNumber: "" });
    expect(issues.some((i) => i.path === "siret")).toBe(true);
  });

  it("rejette une société DOM-TOM (Martinique) sans SIRET", () => {
    const issues = issuesFor({ ...BASE, addressCountry: "MQ", siret: "" });
    expect(issues.some((i) => i.path === "siret")).toBe(true);
  });

  it("rejette une société DOM-TOM (Guadeloupe) sans SIRET", () => {
    const issues = issuesFor({ ...BASE, addressCountry: "GP", siret: "" });
    expect(issues.some((i) => i.path === "siret")).toBe(true);
  });

  it("accepte une société FR avec un SIRET valide 14 chiffres", () => {
    const result = registerSchema.safeParse({
      ...BASE,
      addressCountry: "FR",
      siret: "12345678901234",
    });
    expect(result.success).toBe(true);
  });

  it("accepte une société DOM-TOM (La Réunion) avec un SIRET valide", () => {
    const result = registerSchema.safeParse({
      ...BASE,
      addressCountry: "RE",
      siret: "12345678901234",
    });
    expect(result.success).toBe(true);
  });
});

describe("registerSchema — zone UE hors France", () => {
  it("rejette une société DE sans numéro de TVA", () => {
    const issues = issuesFor({ ...BASE, addressCountry: "DE", vatNumber: "" });
    expect(issues.some((i) => i.path === "vatNumber")).toBe(true);
  });

  it("rejette une société IT sans numéro de TVA", () => {
    const issues = issuesFor({ ...BASE, addressCountry: "IT", vatNumber: "" });
    expect(issues.some((i) => i.path === "vatNumber")).toBe(true);
  });

  it("accepte une société DE avec numéro de TVA valide", () => {
    const result = registerSchema.safeParse({
      ...BASE,
      addressCountry: "DE",
      vatNumber: "DE123456789",
    });
    expect(result.success).toBe(true);
  });

  it("n'impose pas le SIRET pour une société UE hors France", () => {
    const result = registerSchema.safeParse({
      ...BASE,
      addressCountry: "ES",
      vatNumber: "ESB12345678",
      siret: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("registerSchema — zone WORLD", () => {
  it("accepte une société US sans SIRET ni TVA (justificatif géré côté route.ts)", () => {
    const result = registerSchema.safeParse({
      ...BASE,
      addressCountry: "US",
      siret: "",
      vatNumber: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepte une société CH avec numéro d'entreprise facultatif", () => {
    const result = registerSchema.safeParse({
      ...BASE,
      addressCountry: "CH",
      businessRegistrationNumber: "CHE-123.456.789",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un numéro d'entreprise trop court", () => {
    const issues = issuesFor({
      ...BASE,
      addressCountry: "US",
      businessRegistrationNumber: "AB",
    });
    expect(issues.some((i) => i.path === "businessRegistrationNumber")).toBe(true);
  });
});
