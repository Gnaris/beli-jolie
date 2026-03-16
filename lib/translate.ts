/**
 * Service de traduction automatique
 *
 * Priorité :
 * 1. DeepL API (si DEEPL_API_KEY est défini) — haute qualité
 * 2. MyMemory API (gratuit, sans clé) — fallback
 *
 * Cache : les traductions sont stockées dans la table ProductTranslation (DB)
 */

import { prisma } from "@/lib/prisma";

type Locale = "fr" | "en" | "ar";

// ── DeepL language codes ──────────────────────────────────────────────────────
const DEEPL_LANG: Record<Locale, string> = {
  fr: "FR",
  en: "EN-GB",
  ar: "AR",
};

// ── MyMemory language codes ───────────────────────────────────────────────────
const MYMEMORY_LANG: Record<Locale, string> = {
  fr: "fr",
  en: "en",
  ar: "ar",
};

// ── Translate a single string ─────────────────────────────────────────────────

export async function translateText(
  text: string,
  from: Locale,
  to: Locale
): Promise<string> {
  if (from === to || !text.trim()) return text;

  const apiKey = process.env.DEEPL_API_KEY;

  try {
    if (apiKey) {
      return await translateWithDeepl(text, from, to, apiKey);
    }
    return await translateWithMyMemory(text, from, to);
  } catch {
    // Si les deux APIs échouent, retourner le texte original
    return text;
  }
}

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

async function translateWithMyMemory(
  text: string,
  from: Locale,
  to: Locale
): Promise<string> {
  const langPair = `${MYMEMORY_LANG[from]}|${MYMEMORY_LANG[to]}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`MyMemory error ${res.status}`);

  const data = await res.json();
  if (data.responseStatus === 200) {
    return data.responseData?.translatedText ?? text;
  }
  throw new Error("MyMemory translation failed");
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
  // French is the source language — return as-is
  if (locale === "fr") return fallback;

  // Check DB cache
  const cached = await prisma.productTranslation.findUnique({
    where: { productId_locale: { productId, locale } },
  });

  if (cached) {
    return { name: cached.name, description: cached.description };
  }

  // Auto-translate and cache
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
    // Return original if translation fails
    return fallback;
  }
}

// ── Invalidate cached translations for a product (call when product is updated) ──

export async function invalidateProductTranslations(productId: string) {
  await prisma.productTranslation.deleteMany({ where: { productId } });
}
