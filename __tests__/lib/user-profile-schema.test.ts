import { describe, it, expect } from "vitest";
import {
  ProfileSchema,
  AdminProfileSchema,
  nullifyEmpty,
} from "@/lib/user-profile-schema";

const baseValid = {
  firstName: "Pascale",
  lastName: "Haller",
  company: "Penalver Pascale",
  phone: "0682456789",
};

describe("ProfileSchema", () => {
  it("accepte un profil minimal valide", () => {
    const r = ProfileSchema.safeParse(baseValid);
    expect(r.success).toBe(true);
  });

  it("refuse un prénom vide", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, firstName: "  " });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/Prénom/i);
  });

  it("refuse un téléphone au format invalide", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, phone: "abcdef" });
    expect(r.success).toBe(false);
  });

  it("accepte un téléphone international (+33 6 82 45 67 89)", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, phone: "+33682456789" });
    expect(r.success).toBe(true);
  });

  it("accepte un SIRET français à 14 chiffres", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, siret: "12345678901234" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.siret).toBe("12345678901234");
  });

  it("normalise le SIRET en majuscules sans espaces", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, siret: "  ab12 34  cd56 78ef  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.siret).toBe("AB1234CD5678EF");
  });

  it("refuse un SIRET trop court", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, siret: "1234" });
    expect(r.success).toBe(false);
  });

  it("accepte un SIRET vide (optionnel)", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, siret: "" });
    expect(r.success).toBe(true);
  });

  it("normalise le N° TVA en majuscules et refuse un format invalide", () => {
    const ok = ProfileSchema.safeParse({ ...baseValid, vatNumber: "fr12345678901" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.vatNumber).toBe("FR12345678901");

    const ko = ProfileSchema.safeParse({ ...baseValid, vatNumber: "12345" });
    expect(ko.success).toBe(false);
  });

  it("accepte un pays valide (FR, DE, GP)", () => {
    for (const code of ["FR", "DE", "GP"]) {
      const r = ProfileSchema.safeParse({ ...baseValid, addressCountry: code });
      expect(r.success, `pays ${code}`).toBe(true);
    }
  });

  it("refuse un code pays inconnu", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, addressCountry: "ZZ" });
    expect(r.success).toBe(false);
  });

  it("normalise le code pays en majuscules", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, addressCountry: "fr" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.addressCountry).toBe("FR");
  });

  it("refuse un code postal avec caractères spéciaux non autorisés", () => {
    const r = ProfileSchema.safeParse({ ...baseValid, addressZip: "75001!" });
    expect(r.success).toBe(false);
  });
});

describe("AdminProfileSchema", () => {
  const adminValid = { ...baseValid, email: "test@example.com" };

  it("accepte un profil avec email valide", () => {
    const r = AdminProfileSchema.safeParse(adminValid);
    expect(r.success).toBe(true);
  });

  it("refuse un email invalide", () => {
    const r = AdminProfileSchema.safeParse({ ...adminValid, email: "pas-un-email" });
    expect(r.success).toBe(false);
  });

  it("normalise l'email en minuscules et trim", () => {
    const r = AdminProfileSchema.safeParse({ ...adminValid, email: "  Test@Example.COM  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("test@example.com");
  });

  it("hérite des validations de ProfileSchema (téléphone invalide → refusé)", () => {
    const r = AdminProfileSchema.safeParse({ ...adminValid, phone: "xxx" });
    expect(r.success).toBe(false);
  });
});

describe("nullifyEmpty", () => {
  it("null/undefined → null", () => {
    expect(nullifyEmpty(null)).toBeNull();
    expect(nullifyEmpty(undefined)).toBeNull();
  });

  it("chaîne vide ou espaces → null", () => {
    expect(nullifyEmpty("")).toBeNull();
    expect(nullifyEmpty("   ")).toBeNull();
  });

  it("chaîne avec contenu → trimée", () => {
    expect(nullifyEmpty("  toto  ")).toBe("toto");
  });
});
