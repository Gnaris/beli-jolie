/**
 * Service de traduction automatique via l'API Paris Fashion Shop.
 *
 * Endpoint : POST https://wholesaler-api.parisfashionshops.com/api/v1/ai/translations
 * Auth     : Bearer (réutilise les identifiants PFS configurés dans Admin > Paramètres)
 * Body     : { phrases: { keyA: "texte FR", keyB: "texte FR" }, source_language: "fr" }
 * Response : { keyA: { fr, en, de, es, it }, keyB: { fr, en, de, es, it } }
 *
 * Avantages vs DeepL :
 *  - Gratuit (lié au compte PFS de la cliente)
 *  - 5 langues en un seul appel (au lieu d'un appel par locale)
 *  - Pas de quota mensuel à gérer (rate limit 500/h)
 *
 * Limites :
 *  - Ne traduit PAS en arabe ni chinois (le site ne supporte plus ces langues)
 *  - Si la clé PFS est invalide, toute la traduction échoue silencieusement
 */

import { getPfsHeaders, invalidatePfsToken, PFS_BASE_URL } from "@/lib/pfs-auth";
import type { Locale } from "@/i18n/locales";
import { logger } from "@/lib/logger";

export type { Locale };

/** Langues supportées par l'API PFS (toujours retournées) */
export const PFS_TRANSLATION_LOCALES = ["fr", "en", "de", "es", "it"] as const;
export type PfsTranslationLocale = (typeof PFS_TRANSLATION_LOCALES)[number];

/** Sortie : pour chaque clé d'entrée, un objet { locale: traduction } */
export type PfsTranslationResult = Record<string, Partial<Record<PfsTranslationLocale, string>>>;

const DEFAULT_MAX_RETRIES = 5;
const TRANSLATIONS_ENDPOINT = `${PFS_BASE_URL}/ai/translations`;

export function defaultBackoffDelay(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Traduit un lot de phrases en un seul appel API.
 * Retourne un objet où chaque clé d'entrée → { fr, en, de, es, it }.
 *
 * Si toutes les tentatives échouent, retourne `null`. L'appelant choisit
 * alors quoi faire (laisser le texte d'origine, afficher ⚠, etc.).
 *
 * @param phrases Map { clé arbitraire: texte FR à traduire }
 * @param options.maxRetries Nombre maximum de tentatives (défaut 5)
 * @param options.delayFn Fonction backoff (défaut : exponentiel 1/2/4/8/16s)
 */
export async function translatePhrases(
  phrases: Record<string, string>,
  options?: {
    maxRetries?: number;
    delayFn?: (attempt: number) => number;
    sourceLanguage?: PfsTranslationLocale;
  }
): Promise<PfsTranslationResult | null> {
  const entries = Object.entries(phrases).filter(([, value]) => value && value.trim().length > 0);
  if (entries.length === 0) return {};

  const cleanPhrases = Object.fromEntries(entries);
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const delayFn = options?.delayFn ?? defaultBackoffDelay;
  const sourceLanguage = options?.sourceLanguage ?? "fr";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const headers = await getPfsHeaders();
      const res = await fetch(TRANSLATIONS_ENDPOINT, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phrases: cleanPhrases,
          source_language: sourceLanguage,
        }),
        cache: "no-store",
      });

      if (res.status === 401) {
        await invalidatePfsToken();
        throw new Error("PFS translate 401 (token invalidé, retry)");
      }

      if (res.status === 429) {
        throw new Error("PFS translate 429 (rate limit)");
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`PFS translate ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as PfsTranslationResult;
      return data;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        await sleep(delayFn(attempt));
      } else {
        logger.warn("[PFS Translate] échec final après retry", { error });
      }
    }
  }

  return null;
}

/**
 * Traduit un texte unique vers une locale cible précise.
 * Renvoie `null` si la traduction est indisponible.
 *
 * Note : sous le capot, l'API renvoie toutes les langues d'un coup ; cette
 * fonction garde la signature simple pour les usages ponctuels.
 */
export async function translateOne(
  text: string,
  to: Locale,
  options?: { from?: Locale; maxRetries?: number; delayFn?: (attempt: number) => number }
): Promise<string | null> {
  if (!text.trim()) return text;
  const from = options?.from ?? "fr";
  if (from === to) return text;

  const result = await translatePhrases(
    { value: text },
    {
      maxRetries: options?.maxRetries,
      delayFn: options?.delayFn,
      sourceLanguage: from as PfsTranslationLocale,
    }
  );
  if (!result) return null;
  return result.value?.[to as PfsTranslationLocale] ?? null;
}

/**
 * Traduit un texte vers toutes les locales non-FR utilisées par le site.
 * Renvoie { en: "..." } (locales actuellement supportées : fr + en).
 *
 * Si l'API échoue, renvoie `{}` (l'appelant gère le fallback).
 */
export async function translateToAllLocales(
  text: string,
  options?: { from?: Locale; maxRetries?: number; delayFn?: (attempt: number) => number }
): Promise<Record<string, string>> {
  if (!text.trim()) return {};
  const from = options?.from ?? "fr";

  const result = await translatePhrases(
    { value: text },
    {
      maxRetries: options?.maxRetries,
      delayFn: options?.delayFn,
      sourceLanguage: from as PfsTranslationLocale,
    }
  );
  if (!result?.value) return {};

  const out: Record<string, string> = {};
  for (const locale of PFS_TRANSLATION_LOCALES) {
    if (locale === from) continue;
    const val = result.value[locale];
    if (val && val.trim()) out[locale] = val;
  }
  return out;
}

/**
 * Vérifie que la clé PFS est valide en faisant un mini-appel test.
 * Utilisé par l'UI Settings pour le bouton "Tester".
 */
export async function pingPfsTranslation(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await translatePhrases(
      { test: "Bonjour" },
      { maxRetries: 1 }
    );
    if (result?.test?.en) {
      return { ok: true, message: `Traduction OK (« Bonjour » → « ${result.test.en} »)` };
    }
    return { ok: false, message: "L'API PFS n'a pas renvoyé de traduction." };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, message: msg };
  }
}
