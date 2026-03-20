/**
 * Service de traduction automatique via DeepL Free API
 *
 * DeepL Free : 500K caractères/mois (gratuit, clé se termine par ":fx")
 * Quota suivi dans la table TranslationQuota
 */

import { prisma } from "@/lib/prisma";

export type Locale = "fr" | "en" | "ar" | "zh" | "de" | "es" | "it";

const DEEPL_MAX_CHARS = 500_000;

// ── DeepL language codes ──────────────────────────────────────────────────────
const DEEPL_LANG: Record<Locale, string> = {
  fr: "FR",
  en: "EN-GB",
  ar: "AR",
  zh: "ZH-HANS",
  de: "DE",
  es: "ES",
  it: "IT",
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

// ── Main translate function with quota ───────────────────────────────────────

export async function translateText(
  text: string,
  from: Locale,
  to: Locale
): Promise<string> {
  if (from === to || !text.trim()) return text;

  const charCount = text.length;
  const deeplKey = process.env.DEEPL_API_KEY;
  if (!deeplKey) return text;

  const quota = await getQuota();
  if (quota.charsUsed + charCount > quota.maxChars) {
    return text;
  }

  try {
    const result = await translateWithDeepl(text, from, to, deeplKey);
    await addCharsUsed(charCount);
    return result;
  } catch {
    return text;
  }
}

/**
 * Translate a text to ALL non-fr locales at once.
 * Returns a Record<locale, translatedText>.
 * Throws if quota exhausted.
 */
export async function translateToAllLocales(
  text: string,
  from: Locale = "fr"
): Promise<Record<string, string>> {
  if (!text.trim()) return {};

  const targetLocales: Locale[] = ["en", "ar", "zh", "de", "es", "it"];
  const totalChars = text.length * targetLocales.length;

  // Pre-check quota
  const status = await getTranslationQuotaStatus();
  if (status.totalRemaining < totalChars) {
    throw new Error("QUOTA_EXHAUSTED");
  }

  const results: Record<string, string> = {};
  for (const locale of targetLocales) {
    results[locale] = await translateText(text, from, locale);
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
