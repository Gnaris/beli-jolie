/**
 * Service de traduction automatique — désormais branché sur l'API Paris Fashion Shop.
 *
 * Conserve l'API publique historique (translateText, translateTextStrict,
 * translateToAllLocales, getProductTranslation, etc.) pour ne pas casser les
 * appelants existants. Sous le capot, tout passe par `lib/pfs-translate.ts`.
 *
 * Différences avec l'ancienne implémentation DeepL :
 *  - Plus de clé API séparée — réutilise les identifiants PFS configurés
 *  - Plus de quota mensuel à surveiller (l'API PFS est offerte avec le compte)
 *  - Plus de comptage caractères (TranslationQuota n'est plus écrit)
 *  - Langues supportées par PFS : fr/en/de/es/it (le site n'utilise que fr/en aujourd'hui)
 */

import { prisma } from "@/lib/prisma";
import { translatePhrases, translateOne } from "@/lib/pfs-translate";
import { NON_DEFAULT_LOCALES, type Locale } from "@/i18n/locales";

export type { Locale };

const DEFAULT_MAX_RETRIES = 5;

// ── Quota (compat — toujours "illimité" côté PFS) ────────────────────────────

export function defaultBackoffDelay(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

/**
 * Status "quota" conservé pour compatibilité. PFS ne facture pas au caractère
 * donc on retourne une valeur très large + une date de reset symbolique.
 */
export async function getTranslationQuotaStatus() {
  return {
    totalRemaining: Number.MAX_SAFE_INTEGER,
    resetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ── Single-text translation ──────────────────────────────────────────────────

/**
 * Traduit un texte avec retry, retourne `null` si l'API échoue après retry.
 * Les options `maxRetries` / `delayFn` sont passées à PFS.
 */
export async function translateWithRetry(
  text: string,
  from: Locale,
  to: Locale,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  delayFn: (attempt: number) => number = defaultBackoffDelay
): Promise<string | null> {
  if (from === to || !text.trim()) return text;
  return translateOne(text, to, { from, maxRetries, delayFn });
}

/**
 * Traduction "stricte" : renvoie `null` si la traduction échoue après retry,
 * plutôt que la chaîne d'origine. À utiliser pour le cache de traductions
 * (ProductTranslation / CategoryTranslation / etc.) afin de ne PAS stocker
 * de fausses traductions identiques au FR.
 */
export async function translateTextStrict(
  text: string,
  from: Locale,
  to: Locale,
  options?: { maxRetries?: number; delayFn?: (attempt: number) => number }
): Promise<string | null> {
  if (from === to) return text;
  if (!text.trim()) return text;
  return translateOne(text, to, {
    from,
    maxRetries: options?.maxRetries,
    delayFn: options?.delayFn,
  });
}

/**
 * Wrapper de compatibilité : retombe sur le texte d'origine en cas d'échec.
 * À utiliser pour les rendus à la volée où on préfère afficher le FR que rien.
 */
export async function translateText(
  text: string,
  from: Locale,
  to: Locale
): Promise<string> {
  if (from === to || !text.trim()) return text;
  const result = await translateTextStrict(text, from, to);
  return result ?? text;
}

// ── Bulk translation ─────────────────────────────────────────────────────────

/**
 * Traduit un texte vers TOUTES les locales non-défaut en un seul appel à PFS.
 * Bien plus rapide que de boucler langue par langue.
 *
 * Renvoie un objet `{ en: "...", ... }`. Les locales qui échouent sont OMISES
 * (pas de fallback FR pour ne pas masquer les manquants côté UI).
 */
export async function translateToAllLocales(
  text: string,
  from: Locale = "fr",
  options?: { maxRetries?: number; delayFn?: (attempt: number) => number }
): Promise<Record<string, string>> {
  if (!text.trim()) return {};

  const result = await translatePhrases(
    { value: text },
    {
      maxRetries: options?.maxRetries,
      delayFn: options?.delayFn,
      sourceLanguage: from as "fr",
    }
  );
  if (!result?.value) return {};

  const out: Record<string, string> = {};
  for (const locale of NON_DEFAULT_LOCALES) {
    const val = result.value[locale as "fr" | "en" | "de" | "es" | "it"];
    if (val && val.trim()) out[locale] = val;
  }
  return out;
}

/** Traduit plusieurs textes vers UNE locale cible. */
export async function translateBatch(
  texts: string[],
  from: Locale,
  to: Locale
): Promise<string[]> {
  if (from === to) return texts;
  return Promise.all(texts.map((t) => translateText(t, from, to)));
}

// ── Product translation cache helpers (ProductTranslation table) ─────────────

export async function getProductTranslation(
  productId: string,
  locale: Locale,
  fallback: { name: string; description: string }
): Promise<{ name: string; description: string }> {
  if (locale === "fr") return fallback;

  const cached = await prisma.productTranslation.findUnique({
    where: { productId_locale: { productId, locale } },
  });

  if (cached) {
    return { name: cached.name, description: cached.description };
  }

  try {
    const [name, description] = await Promise.all([
      translateText(fallback.name, "fr", locale),
      translateText(fallback.description, "fr", locale),
    ]);

    await prisma.productTranslation.create({
      data: { productId, locale, name, description },
    });

    return { name, description };
  } catch {
    return fallback;
  }
}

export async function invalidateProductTranslations(productId: string) {
  await prisma.productTranslation.deleteMany({ where: { productId } });
}
