import { z } from "zod";

/**
 * Schémas de validation Zod — Authentification
 */

/** Connexion */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "L'email est requis.")
    .email("Format d'email invalide."),
  password: z
    .string()
    .min(1, "Le mot de passe est requis.")
    .min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

/** Inscription BtoB */
export const registerSchema = z.object({
  firstName: z
    .string()
    .min(1, "Le prénom est requis.")
    .max(50, "Prénom trop long."),
  lastName: z
    .string()
    .min(1, "Le nom est requis.")
    .max(50, "Nom trop long."),
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
    .regex(
      /^(\+33|0)[1-9](\d{8})$/,
      "Format de téléphone invalide (ex: 0612345678 ou +33612345678)."
    ),
  siret: z
    .string()
    .length(14, "Le SIRET doit contenir exactement 14 chiffres.")
    .regex(/^\d{14}$/, "Le SIRET ne doit contenir que des chiffres."),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
    .regex(/[A-Z]/, "Le mot de passe doit contenir au moins une majuscule.")
    .regex(/[0-9]/, "Le mot de passe doit contenir au moins un chiffre."),
  confirmPassword: z.string().min(1, "Veuillez confirmer le mot de passe."),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Les mots de passe ne correspondent pas.",
  path: ["confirmPassword"],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
