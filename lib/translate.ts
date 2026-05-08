/**
 * Service de traduction automatique via DeepL Free API
 *
 * DeepL Free : 500K caractères/mois (gratuit, clé se termine par ":fx")
 * Quota suivi dans la table TranslationQuota
 *
 * Retry inline : chaque appel DeepL est retenté jusqu'à 5 fois avec backoff
 * exponentiel (1s, 2s, 4s, 8s, 16s) en cas d'échec (429, 500, network…).
 * Si toutes les tentatives échouent, on renvoie `null` plutôt que d'écrire
 * la valeur FR par défaut en base (ce qui produirait une fausse traduction).
 */

import { prisma } from "@/lib/prisma";
import { decryptIfSensitive } from "@/lib/encryption";
import { NON_DEFAULT_LOCALES, type Locale } from "@/i18n/locales";

export type { Locale };

/** Récupère la clé API DeepL depuis la DB (déchiffrée), sans fallback env. */
async function getDeeplApiKey(): Promise<string | null> {
  const config = await prisma.siteConfig.findUnique({
    where: { key: "deepl_api_key" },
  });
  return config?.value ? decryptIfSensitive("deepl_api_key", config.value) : null;
}

const DEEPL_MAX_CHARS = 500_000;
const DEFAULT_MAX_RETRIES = 5;

// ── DeepL language codes ──────────────────────────────────────────────────────
const DEEPL_LANG: Record<Locale, string> = {
  fr: "FR",
  en: "EN-GB",
};

// ── Quota management ─────────────────────────────────────────────────────────

function getCurrentMonthYear(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Get or create quota row for the current month */
async function getQuota() {
  const monthYear = getCurrentMonthYear();

  return prisma.translationQuota.upsert({
    where: { provider_monthYear: { provider: "deepl", monthYear } },
    update: {},
    create: { provider: "deepl", monthYear, charsUsed: 0, maxChars: DEEPL_MAX_CHARS },
  });
}

/** Get remaining chars */
export async function getTranslationQuotaStatus() {
  const monthYear = getCurrentMonthYear();
  const quota = await prisma.translationQuota.findUnique({
    where: { provider_monthYear: { provider: "deepl", monthYear } },
  });

  const used = quota?.charsUsed ?? 0;
  const totalRemaining = Math.max(0, DEEPL_MAX_CHARS - used);

  // Reset date = 1st of next month
  const now = new Date();
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    totalRemaining,
    resetDate: resetDate.toISOString(),
  };
}

/** Increment chars used */
async function addCharsUsed(chars: number) {
  const monthYear = getCurrentMonthYear();

  await prisma.translationQuota.upsert({
    where: { provider_monthYear: { provider: "deepl", monthYear } },
    update: { charsUsed: { increment: chars } },
    create: { provider: "deepl", monthYear, charsUsed: chars, maxChars: DEEPL_MAX_CHARS },
  });
}

// ── Translation engine ──────────────────────────────────────────────────────

async function translateWithDeepl(
  text: string,
  from: Locale,
  to: Locale,
  apiKey: string
): Promise<string> {
  const isFreePlan = apiKey.endsWith(":fx");
  const baseUrl = isFreePlan
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";

  const res = await fetch(`${baseUrl}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      source_lang: DEEPL_LANG[from],
      target_lang: DEEPL_LANG[to],
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) throw new Error(`DeepL error ${res.status}`);

  const data = await res.json();
  return data.translations?.[0]?.text ?? text;
}

// ── Retry helper ─────────────────────────────────────────────────────────────

/** Default delay function : `Math.pow(2, attempt) * 1000` (1s, 2s, 4s, 8s, 16s). */
export function defaultBackoffDelay(attempt: number): number {
  return Math.pow(2, attempt) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Appelle DeepL avec retry exponentiel.
 *
 * @param text Texte à traduire
 * @param from Locale source
 * @param to Locale cible
 * @param maxRetries Nombre maximum de tentatives (défaut 5)
 * @param delayFn Fonction qui renvoie le délai en ms pour une tentative donnée
 *                (utile pour les tests : `() => 0` désactive l'attente)
 * @returns La traduction, ou `null` si toutes les tentatives ont échoué.
 */
export async function translateWithRetry(
  text: string,
  from: Locale,
  to: Locale,
  maxRetries: number = DEFAULT_MAX_RETRIES,
  delayFn: (attempt: number) => number = defaultBackoffDelay
): Promise<string | null> {
  if (from === to || !text.trim()) return text;

  const apiKey = await getDeeplApiKey();
  if (!apiKey) return null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await translateWithDeepl(text, from, to, apiKey);
      // DeepL renvoie une traduction vide ? On considère ça comme un échec à retenter.
      if (typeof result === "string" && result.length > 0) {
        return result;
      }
      throw new Error("DeepL empty response");
    } catch {
      if (attempt < maxRetries - 1) {
        await sleep(delayFn(attempt));
      }
    }
  }
  return null;
}

// ── Strict variant : returns null on failure (no FR fallback) ────────────────

/**
 * Traduction "stricte" : renvoie `null` si DeepL échoue après retry, plutôt
 * que la chaîne d'origine. À utiliser pour le cache de traductions afin de
 * ne PAS stocker de fausses traductions identiques au FR.
 */
export async function translateTextStrict(
  text: string,
  from: Locale,
  to: Locale,
  options?: { maxRetries?: number; delayFn?: (attempt: number) => number }
): Promise<string | null> {
  if (from === to) return text;
  if (!text.trim()) return text;

  const charCount = text.length;
  const deeplKey = await getDeeplApiKey();
  if (!deeplKey) return null;

  const quota = await getQuota();
  if (quota.charsUsed + charCount > quota.maxChars) {
    return null;
  }

  const result = await translateWithRetry(
    text,
    from,
    to,
    options?.maxRetries ?? DEFAULT_MAX_RETRIES,
    options?.delayFn ?? defaultBackoffDelay
  );

  if (result === null) return null;
  await addCharsUsed(charCount);
  return result;
}

// ── Main translate function with quota (compat wrapper) ──────────────────────

/**
 * Wrapper de compatibilité : retombe sur le texte d'origine en cas d'échec
 * (utilisé pour les descriptions produit où l'on préfère afficher le FR
 * plutôt qu'une chaîne vide). Pour le cache de traductions stockées en BDD,
 * préférer `translateTextStrict`.
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

/**
 * Translate a text to ALL non-fr locales at once.
 * Returns a Record<locale, translatedText>.
 * Throws if quota exhausted.
 *
 * Locales pour lesquelles DeepL échoue après retry sont OMISES du résultat
 * (pas de fallback FR pour ne pas masquer les manquants côté UI).
 */
export async function translateToAllLocales(
  text: string,
  from: Locale = "fr",
  options?: { maxRetries?: number; delayFn?: (attempt: number) => number }
): Promise<Record<string, string>> {
  if (!text.trim()) return {};

  const targetLocales: Locale[] = NON_DEFAULT_LOCALES;
  const totalChars = text.length * targetLocales.length;

  // Pre-check quota
  const status = await getTranslationQuotaStatus();
  if (status.totalRemaining < totalChars) {
    throw new Error("QUOTA_EXHAUSTED");
  }

  const results: Record<string, string> = {};
  for (const locale of targetLocales) {
    const value = await translateTextStrict(text, from, locale, options);
    if (value !== null && value !== "") {
      results[locale] = value;
    }
  }
  return results;
}

// ── Translate multiple strings at once ────────────────────────────────────────

export async function translateBatch(
  texts: string[],
  from: Locale,
  to: Locale
): Promise<string[]> {
  if (from === to) return texts;
  return Promise.all(texts.map((t) => translateText(t, from, to)));
}

// ── Get (or create) product translation from DB cache ────────────────────────

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

// ── Invalidate cached translations for a product ─────────────────────────────

export async function invalidateProductTranslations(productId: string) {
  await prisma.productTranslation.deleteMany({ where: { productId } });
}
