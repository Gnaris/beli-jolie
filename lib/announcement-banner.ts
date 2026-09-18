/**
 * Helpers dédiés au bandeau d'annonces de la page d'accueil.
 *
 * Le bandeau est stocké dans SiteConfig["announcement_banner"] sous forme de JSON.
 * Historiquement, `messages` était un `string[]` en français uniquement. Depuis
 * 2026-09-18 la cliente peut aussi saisir la version anglaise pour matcher le
 * reste du site (auto-traduction + override manuel possible côté admin).
 *
 * Nouveau format :
 *   {
 *     messages: [{ fr: "…", en?: "…" }, …],
 *     bgColor, textColor, speed, mode
 *   }
 *
 * L'ancien format (`messages: string[]`) reste lu en fallback pour ne pas casser
 * les bandeaux déjà enregistrés — `normalizeAnnouncementMessages()` uniformise.
 */

import type { Locale } from "@/i18n/locales";

export interface AnnouncementMessage {
  fr: string;
  en?: string;
}

export interface AnnouncementBannerPayload {
  messages: AnnouncementMessage[];
  bgColor: string;
  textColor: string;
  speed: number;
  mode: "scroll" | "static";
}

/**
 * Convertit un `messages` brut lu depuis la BDD (string ou objet) en tableau
 * d'objets `{ fr, en? }`. Ignore les entrées vides / mal formées.
 */
export function normalizeAnnouncementMessages(raw: unknown): AnnouncementMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: AnnouncementMessage[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const fr = item.trim();
      if (fr) out.push({ fr });
      continue;
    }
    if (item && typeof item === "object") {
      const fr = typeof (item as { fr?: unknown }).fr === "string"
        ? (item as { fr: string }).fr.trim()
        : "";
      if (!fr) continue;
      const enRaw = (item as { en?: unknown }).en;
      const en = typeof enRaw === "string" && enRaw.trim() ? enRaw.trim() : undefined;
      out.push(en ? { fr, en } : { fr });
    }
  }
  return out;
}

/**
 * Sélectionne, pour chaque message, la variante correspondant à la locale
 * demandée. Fallback FR si la traduction manque — la cliente n'a jamais
 * l'obligation de remplir l'anglais.
 */
export function resolveLocalizedMessages(
  messages: AnnouncementMessage[],
  locale: Locale,
): string[] {
  return messages
    .map((m) => {
      if (locale === "en" && m.en && m.en.trim()) return m.en.trim();
      return m.fr.trim();
    })
    .filter((s) => s.length > 0);
}
