import { z } from "zod";
import {
  WHATSAPP_TEMPLATE_TITLE_MAX,
  WHATSAPP_TEMPLATE_BODY_MAX,
  WHATSAPP_NO_EMOJI_ERROR,
  containsEmoji,
} from "@/lib/whatsapp-message";

/**
 * Validation partagée pour create/update d'un modèle WhatsApp.
 *
 * Ce schéma vit dans un fichier séparé (et non dans la server action)
 * parce qu'un fichier `"use server"` ne peut exporter que des fonctions
 * async — un objet Zod violerait cette contrainte.
 *
 * Règle emoji : on refuse toute saisie contenant un emoji car WhatsApp
 * Desktop les casse à l'envoi via `?text=` (👋 → �). Voir `containsEmoji`.
 */
function optionalLocalizedBody(label: string) {
  return z
    .string()
    .trim()
    .max(WHATSAPP_TEMPLATE_BODY_MAX, `Version ${label} trop longue (max ${WHATSAPP_TEMPLATE_BODY_MAX} caractères).`)
    .refine((v) => !containsEmoji(v), WHATSAPP_NO_EMOJI_ERROR)
    .optional()
    .default("");
}

export const whatsAppTemplateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Le titre est obligatoire.")
    .max(WHATSAPP_TEMPLATE_TITLE_MAX, `Titre trop long (max ${WHATSAPP_TEMPLATE_TITLE_MAX} caractères).`)
    .refine((v) => !containsEmoji(v), WHATSAPP_NO_EMOJI_ERROR),
  body: z
    .string()
    .trim()
    .min(1, "Le contenu est obligatoire.")
    .max(WHATSAPP_TEMPLATE_BODY_MAX, `Contenu trop long (max ${WHATSAPP_TEMPLATE_BODY_MAX} caractères).`)
    .refine((v) => !containsEmoji(v), WHATSAPP_NO_EMOJI_ERROR),
  // Versions traduites éditées manuellement par la cliente (ou vides, dans
  // ce cas on tente une auto-traduction serveur). La règle emoji s'applique
  // à toutes car WhatsApp Desktop casse `?text=` avec emojis.
  bodyEn: optionalLocalizedBody("anglaise"),
  bodyDe: optionalLocalizedBody("allemande"),
  bodyIt: optionalLocalizedBody("italienne"),
  bodyEs: optionalLocalizedBody("espagnole"),
});

export type WhatsAppTemplateInput = z.infer<typeof whatsAppTemplateSchema>;
