/**
 * Charge un `NewsletterTemplate` + ses versions locales et renvoie la
 * (subject, html) à utiliser pour un destinataire donné.
 *
 * Pipeline :
 *   1. Résout la langue cible via le pays du client (`resolveLocaleFromCountry`).
 *   2. Charge le template + ses lignes `NewsletterTemplateLocale`.
 *   3. Cascade de secours (locale cible → EN → FR) : s'arrête à la 1ʳᵉ
 *      version non-vide. Si FR lui-même est vide (ne devrait jamais arriver,
 *      la BDD n'accepte pas un template sans HTML côté UI), on remonte quand
 *      même la version FR brute pour que le worker loggue l'anomalie plutôt
 *      que de crasher.
 *
 * Utilisé par les 4 workers transactionnels (abandoned-cart, inactive-client,
 * restock, bulk-mail) ET par les 2 server actions d'envoi (bulk users,
 * bulk fiches) — un seul chemin de résolution pour que l'aperçu ne mente
 * jamais sur le mail réel.
 */

import { prisma } from "@/lib/prisma";
import {
  MAIL_LOCALE_FALLBACK,
  resolveLocaleFromCountry,
  type MailLocale,
} from "@/lib/user-locale";

export interface ResolvedTemplate {
  templateId: string;
  name: string;
  /** Langue effectivement choisie après cascade de secours. */
  locale: MailLocale;
  subject: string;
  html: string;
  images: Array<{ name: string; path: string }>;
  scenarioKey: string | null;
}

/**
 * Résout le contenu localisé d'un modèle pour un pays donné. Retourne
 * `null` si le template n'existe pas ou si toutes les versions sont vides.
 */
export async function resolveTemplateForCountry(
  templateId: string,
  countryIso: string | null,
): Promise<ResolvedTemplate | null> {
  const target = resolveLocaleFromCountry(countryIso);
  return resolveTemplateForLocale(templateId, target);
}

/** Variante quand la langue est déjà connue (test manuel admin, etc.). */
export async function resolveTemplateForLocale(
  templateId: string,
  target: MailLocale,
): Promise<ResolvedTemplate | null> {
  const template = await prisma.newsletterTemplate.findFirst({
    where: { id: templateId },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
        select: { name: true, path: true },
      },
      locales: {
        select: { locale: true, subject: true, html: true },
      },
    },
  });
  if (!template) return null;

  // Index par locale : FR vit sur le template principal, les 4 autres sur
  // les lignes `locales`. On considère une version « vide » si html absent/vide
  // (le sujet seul ne suffit pas).
  const byLocale: Record<MailLocale, { subject: string; html: string } | null> = {
    fr:
      template.html && template.html.trim().length > 0
        ? { subject: template.subject, html: template.html }
        : null,
    en: null,
    de: null,
    es: null,
    it: null,
  };
  for (const l of template.locales) {
    if (l.locale !== "en" && l.locale !== "de" && l.locale !== "es" && l.locale !== "it") continue;
    if (l.html && l.html.trim().length > 0) {
      byLocale[l.locale] = { subject: l.subject, html: l.html };
    }
  }

  const order: MailLocale[] = [target, ...MAIL_LOCALE_FALLBACK.filter((l) => l !== target)];
  for (const l of order) {
    const content = byLocale[l];
    if (content) {
      return {
        templateId: template.id,
        name: template.name,
        locale: l,
        subject: content.subject,
        html: content.html,
        images: template.images,
        scenarioKey: template.scenarioKey,
      };
    }
  }

  // Garde-fou : si FR est vide (templates mal seedés, data corrompue…),
  // on remonte FR tel quel pour que le worker loggue plutôt que crash.
  return {
    templateId: template.id,
    name: template.name,
    locale: "fr",
    subject: template.subject,
    html: template.html ?? "",
    images: template.images,
    scenarioKey: template.scenarioKey,
  };
}
