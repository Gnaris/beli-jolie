import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { translateToAllLocales, getTranslationQuotaStatus } from "@/lib/translate";

/**
 * POST /api/admin/translate-batch
 * Body: { texts: string[] }
 * Returns: { results: Record<locale, string>[], remaining: number, resetDate: string }
 *
 * Translates multiple French texts to all 6 non-fr locales in one call.
 * Used by "Tout traduire" buttons on attribute pages.
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

  // Filter valid non-empty texts
  const validTexts = texts.map((t: unknown) =>
    typeof t === "string" ? t.trim() : ""
  );

  const totalChars = validTexts.reduce((sum: number, t: string) => sum + t.length, 0) * 6;

  // Pre-check quota
  const preStatus = await getTranslationQuotaStatus();
  if (preStatus.totalRemaining < totalChars) {
    const resetDate = new Date(preStatus.resetDate);
    const formatted = resetDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return NextResponse.json(
      {
        error: "QUOTA_EXHAUSTED",
        message: `Quota insuffisant. Caractères nécessaires : ${totalChars.toLocaleString("fr-FR")}, restants : ${preStatus.totalRemaining.toLocaleString("fr-FR")}. Réinitialisation le ${formatted}.`,
        remaining: preStatus.totalRemaining,
        resetDate: preStatus.resetDate,
      },
      { status: 429 }
    );
  }

  try {
    const results: Record<string, string>[] = [];

    for (const text of validTexts) {
      if (!text) {
        results.push({});
        continue;
      }
      const translations = await translateToAllLocales(text);
      results.push(translations);
    }

    const postStatus = await getTranslationQuotaStatus();

    return NextResponse.json({
      results,
      remaining: postStatus.totalRemaining,
      resetDate: postStatus.resetDate,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "QUOTA_EXHAUSTED") {
      const status = await getTranslationQuotaStatus();
      const resetDate = new Date(status.resetDate);
      const formatted = resetDate.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      return NextResponse.json(
        {
          error: "QUOTA_EXHAUSTED",
          message: `Quota épuisé en cours de traduction. Réinitialisation le ${formatted}.`,
          remaining: status.totalRemaining,
          resetDate: status.resetDate,
        },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Erreur lors de la traduction" },
      { status: 500 }
    );
  }
}
