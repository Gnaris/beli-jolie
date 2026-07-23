import { z } from "zod";

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
  siret: z
    .string()
    .length(14, "Le SIRET doit contenir exactement 14 chiffres.")
    .regex(/^\d{14}$/, "Le SIRET ne doit contenir que des chiffres."),
  vatNumber: z
    .string()
    .regex(
      /^[A-Z]{2}[A-Z0-9]{2,13}$/,
      "Format invalide (ex: FR12345678901, DE123456789)."
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
  marketingConsent: z.boolean().optional().default(true),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Les mots de passe ne correspondent pas.",
  path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
