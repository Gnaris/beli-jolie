import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { translatePhrases, PFS_TRANSLATION_LOCALES } from "@/lib/pfs-translate";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

/**
 * POST /api/admin/translate-batch
 * Body: { texts: string[] }
 * Returns: { results: Record<locale, string>[], remaining: number }
 *
 * Traduit plusieurs textes français vers toutes les locales du site en UN seul
 * appel à l'API PFS (les textes sont passés sous forme de clés indexées).
 */

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { texts } = await req.json();
  if (!Array.isArray(texts) || texts.length === 0) {
    return NextResponse.json({ error: "Tableau de textes requis" }, { status: 400 });
  }

  const validTexts = texts.map((t: unknown) => (typeof t === "string" ? t.trim() : ""));
  const phrases: Record<string, string> = {};
  validTexts.forEach((text, idx) => {
    if (text) phrases[`item_${idx}`] = text;
  });

  if (Object.keys(phrases).length === 0) {
    return NextResponse.json({
      results: validTexts.map(() => ({})),
      remaining: Number.MAX_SAFE_INTEGER,
    });
  }

  try {
    const data = await translatePhrases(phrases);
    if (!data) {
      return NextResponse.json(
        { error: "Erreur lors de la traduction" },
        { status: 500 }
      );
    }

    const targets = NON_DEFAULT_LOCALES.filter((l) =>
      (PFS_TRANSLATION_LOCALES as readonly string[]).includes(l)
    );

    const results = validTexts.map((text, idx) => {
      if (!text) return {} as Record<string, string>;
      const entry = data[`item_${idx}`] ?? {};
      const out: Record<string, string> = {};
      for (const locale of targets) {
        const val = entry[locale as "fr" | "en" | "de" | "es" | "it"];
        if (val && val.trim()) out[locale] = val;
      }
      return out;
    });

    return NextResponse.json({
      results,
      remaining: Number.MAX_SAFE_INTEGER,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur lors de la traduction" },
      { status: 500 }
    );
  }
}
