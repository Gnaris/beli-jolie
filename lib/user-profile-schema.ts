import { z } from "zod";
import { COUNTRIES } from "@/lib/vat";

const PHONE_REGEX = /^(\+\d{1,3}|0)[1-9]\d{7,12}$/;
const VAT_REGEX = /^([A-Z]{2}[A-Z0-9]{2,13})?$/;
// SIRET français = 14 chiffres. On accepte aussi les registres étrangers,
// donc format alphanumérique 8-25 caractères en majuscules/chiffres.
const SIRET_REGEX = /^[A-Z0-9]{8,25}$/;
const ZIP_REGEX = /^[A-Z0-9 \-]{2,12}$/i;

const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

/**
 * Champs éditables sur un profil client — communs à l'espace pro et à l'admin.
 * Le mail est exclu (voir `AdminProfileSchema` pour la version admin).
 */
export const ProfileSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis.").max(80),
  lastName: z.string().trim().min(1, "Nom requis.").max(80),
  company: z.string().trim().min(1, "Société requise.").max(120),
  phone: z
    .string()
    .trim()
    .regex(PHONE_REGEX, "Numéro de téléphone invalide."),
  siret: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine(
      (s) => s === "" || SIRET_REGEX.test(s),
      "SIRET invalide (8 à 25 caractères alphanumériques).",
    )
    .optional()
    .or(z.literal("")),
  vatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => s === "" || VAT_REGEX.test(s), "Numéro de TVA invalide.")
    .optional()
    .or(z.literal("")),
  addressStreet: z.string().trim().max(200).optional().or(z.literal("")),
  addressComplement: z.string().trim().max(200).optional().or(z.literal("")),
  addressZip: z
    .string()
    .trim()
    .max(12)
    .refine((s) => s === "" || ZIP_REGEX.test(s), "Code postal invalide.")
    .optional()
    .or(z.literal("")),
  addressCity: z.string().trim().max(100).optional().or(z.literal("")),
  addressCountry: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === "" || COUNTRY_CODES.has(s), "Pays inconnu.")
    .optional()
    .or(z.literal("")),
});

export type ProfileInput = z.infer<typeof ProfileSchema>;

/**
 * Variante admin : ajoute l'email. Le format est validé mais l'unicité
 * (par tenant) doit être vérifiée par le caller — Zod ne connaît pas la BDD.
 */
export const AdminProfileSchema = ProfileSchema.extend({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email invalide.")
    .max(180),
});

export type AdminProfileInput = z.infer<typeof AdminProfileSchema>;

/** Normalise un champ optionnel : "" → null, sinon la valeur trimée. */
export function nullifyEmpty(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}
