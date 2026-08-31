import { z } from "zod";
import { getCompanyZone } from "@/lib/vat";

/**
 * Schémas de validation Zod — Authentification
 */

/** Connexion — pas de contrainte de longueur ici (pas d'indice sur la
 *  politique du mot de passe côté connexion, et compat avec anciens comptes). */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "L'email est requis.")
    .email("Format d'email invalide."),
  password: z
    .string()
    .min(1, "Le mot de passe est requis."),
});

/** Inscription BtoB */
export const registerSchema = z.object({
  firstName: z
    .string()
    .max(50, "Prénom trop long.")
    .optional()
    .or(z.literal("")),
  lastName: z
    .string()
    .max(50, "Nom trop long.")
    .optional()
    .or(z.literal("")),
  company: z
    .string()
    .min(1, "Le nom de la société est requis.")
    .max(100, "Nom de société trop long."),
  email: z
    .string()
    .min(1, "L'email est requis.")
    .email("Format d'email invalide."),
  phone: z
    .string()
    .min(1, "Le téléphone est requis.")
    // P3-07 — accepte les numéros internationaux (1 à 3 chiffres après +)
    // ou un numéro français commençant par 0. 7 à 13 chiffres après le préfixe.
    .regex(
      /^(\+\d{1,3}|0)[1-9]\d{7,12}$/,
      "Format de téléphone invalide (ex: 0612345678, +33612345678, +49301234567).",
    ),
  // Facultatif : les clients étrangers n'ont pas de SIRET. Si présent, on
  // exige le format français à 14 chiffres pour éviter les saisies bidon.
  siret: z
    .string()
    .regex(/^\d{14}$/, "Le SIRET doit contenir exactement 14 chiffres.")
    .optional()
    .or(z.literal("")),
  // Format libre : chaque pays UE a son propre format (BE0123456789,
  // FR12345678901, IT12345678901, BE 0123.456.789 avec ou sans préfixe
  // pays, franchise TVA belge sans préfixe, etc.). L'admin vérifie
  // manuellement le numéro à la validation du dossier — ici on se contente
  // d'une longueur raisonnable et d'un jeu de caractères sain.
  vatNumber: z
    .string()
    .min(4, "Le numéro de TVA est trop court.")
    .max(32, "Le numéro de TVA est trop long (32 caractères max).")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9\-./ ]*[A-Za-z0-9]$/,
      "Caractères autorisés : lettres, chiffres, tirets, points, espaces."
    )
    .optional()
    .or(z.literal("")),
  // N° d'enregistrement d'entreprise pour les clients hors UE
  // (Companies House UK, EIN US, CR CH, etc.). Format libre 4-32 chars
  // alphanumérique + tirets, pour couvrir tous les registres du monde.
  businessRegistrationNumber: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9\-./ ]{2,30}[A-Za-z0-9]$/,
      "Numéro d'entreprise invalide (4 à 32 caractères).",
    )
    .optional()
    .or(z.literal("")),
  addressStreet: z
    .string()
    .min(1, "L'adresse est requise.")
    .max(200, "Adresse trop longue."),
  addressComplement: z
    .string()
    .max(200, "Complément d'adresse trop long.")
    .optional()
    .or(z.literal("")),
  addressZip: z
    .string()
    .min(1, "Le code postal est requis.")
    .max(20, "Code postal trop long."),
  addressCity: z
    .string()
    .min(1, "La ville est requise.")
    .max(100, "Nom de ville trop long."),
  addressCountry: z
    .string()
    .min(1, "Veuillez sélectionner votre pays.")
    .regex(/^[A-Z]{2}$/, "Code pays invalide (format ISO-2, ex: FR)."),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule.")
    .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre."),
  confirmPassword: z.string().min(1, "Veuillez confirmer le mot de passe."),
  registrationMessage: z
    .string()
    .max(2000, "Le message ne doit pas dépasser 2000 caractères.")
    .optional()
    .or(z.literal("")),
  // Consentement CGU obligatoire (wizard étape 5). Sans coche = z.literal(true)
  // renvoie une erreur bloquante.
  acceptsTerms: z.literal(true, {
    message: "Vous devez accepter les CGU pour créer votre compte.",
  }),
  // Newsletter facultative. Défaut false. Couvre nouveautés + promos +
  // relances panier abandonné (case unique, cf. mémoire projet).
  acceptsNewsletter: z.boolean().optional().default(false),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Les mots de passe ne correspondent pas.",
  path: ["confirmPassword"],
}).superRefine((data, ctx) => {
  // Règles conditionnelles selon le pays de la société.
  // FR + DOM-TOM : SIRET obligatoire (14 chiffres, régime commun).
  // UE hors FR   : TVA intracom obligatoire (sinon on ne peut pas
  //                auto-liquider et le client se voit facturer 20 % à tort).
  // Reste monde  : rien de plus côté Zod (justificatif d'entreprise
  //                obligatoire mais vérifié côté route.ts, car FormData).
  const zone = getCompanyZone(data.addressCountry);
  if (zone === "FR" && !data.siret) {
    ctx.addIssue({
      code: "custom",
      path: ["siret"],
      message: "Le SIRET est requis pour une société française (14 chiffres).",
    });
  }
  if (zone === "EU" && !data.vatNumber) {
    ctx.addIssue({
      code: "custom",
      path: ["vatNumber"],
      message:
        "Le numéro de TVA intracommunautaire est requis pour un client européen.",
    });
  }
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
