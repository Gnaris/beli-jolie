import { z } from "zod";
import {
  WHATSAPP_TEMPLATE_TITLE_MAX,
  WHATSAPP_TEMPLATE_BODY_MAX,
} from "@/lib/whatsapp-message";

/**
 * Validation partagée pour create/update d'un modèle WhatsApp.
 *
 * Ce schéma vit dans un fichier séparé (et non dans la server action)
 * parce qu'un fichier `"use server"` ne peut exporter que des fonctions
 * async — un objet Zod violerait cette contrainte.
 */
export const whatsAppTemplateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Le titre est obligatoire.")
    .max(WHATSAPP_TEMPLATE_TITLE_MAX, `Titre trop long (max ${WHATSAPP_TEMPLATE_TITLE_MAX} caractères).`),
  body: z
    .string()
    .trim()
    .min(1, "Le contenu est obligatoire.")
    .max(WHATSAPP_TEMPLATE_BODY_MAX, `Contenu trop long (max ${WHATSAPP_TEMPLATE_BODY_MAX} caractères).`),
});

export type WhatsAppTemplateInput = z.infer<typeof whatsAppTemplateSchema>;
