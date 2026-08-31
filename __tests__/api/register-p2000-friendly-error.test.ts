import { describe, it, expect } from "vitest";

/**
 * POST /api/auth/register — traduction d'une erreur Prisma P2000
 * (« provided value too long for column ») en 400 avec un libellé
 * lisible pour la cliente.
 *
 * Bug d'origine : la cliente Sheima (2026-08-31) a rempli le champ
 * "message à notre équipe" avec un long paragraphe (> 191 caractères).
 * Zod .max(2000) laissait passer mais la colonne SQL était encore en
 * VARCHAR(191) (défaut Prisma MySQL) → P2000 → 500 générique.
 * Fix : passer registrationMessage en @db.Text + intercepter P2000.
 *
 * On teste juste la fonction de résolution du libellé (pure), la vraie
 * intégration Prisma vit dans app/api/auth/register/route.ts.
 */

const FIELD_LABELS: Record<string, string> = {
  registrationMessage: "Message à notre équipe",
  addressStreet: "Adresse",
  addressComplement: "Complément d'adresse",
  addressCity: "Ville",
  company: "Société",
  firstName: "Prénom",
  lastName: "Nom",
  email: "E-mail",
  phone: "Téléphone",
  siret: "SIRET",
  vatNumber: "N° TVA intra",
};

function buildTooLongMessage(column: string | undefined): string {
  const label = column ? (FIELD_LABELS[column] ?? column) : "un champ";
  return `Le champ « ${label} » est trop long. Raccourcissez le texte puis renvoyez votre demande.`;
}

describe("Register P2000 → message lisible", () => {
  it("registrationMessage → libellé français « Message à notre équipe »", () => {
    expect(buildTooLongMessage("registrationMessage")).toContain("Message à notre équipe");
  });

  it("company → libellé « Société »", () => {
    expect(buildTooLongMessage("company")).toContain("Société");
  });

  it("colonne inconnue → renvoie le nom brut plutôt que « un champ »", () => {
    // Si Prisma nous file un nom qu'on n'a pas mappé, on préfère montrer
    // ce nom brut à la cliente qu'un générique — elle pourra le signaler.
    expect(buildTooLongMessage("someUnknownColumn")).toContain("someUnknownColumn");
  });

  it("colonne absente (Prisma meta vide) → « un champ »", () => {
    expect(buildTooLongMessage(undefined)).toContain("un champ");
  });

  it("le message final invite bien à raccourcir puis renvoyer", () => {
    const msg = buildTooLongMessage("registrationMessage");
    expect(msg).toMatch(/raccourcissez/i);
    expect(msg).toMatch(/renvoyez/i);
  });
});
