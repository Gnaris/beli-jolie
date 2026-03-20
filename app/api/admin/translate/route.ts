import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { translateToAllLocales, getTranslationQuotaStatus } from "@/lib/translate";

/**
 * POST /api/admin/translate
 * Body: { text: string }
 * Returns: { translations: Record<locale, string>, remaining: number, resetDate: string }
 *
 * GET /api/admin/translate
 * Returns: { remaining: number, resetDate: string }
 */

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const status = await getTranslationQuotaStatus();
  return NextResponse.json({
    remaining: status.totalRemaining,
    resetDate: status.resetDate,
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { text } = await req.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Texte requis" }, { status: 400 });
  }

  // Check quota before translating
  const charsNeeded = text.length * 6; // 6 target locales
  const preStatus = await getTranslationQuotaStatus();

  if (preStatus.totalRemaining < charsNeeded) {
    const resetDate = new Date(preStatus.resetDate);
    const formatted = resetDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return NextResponse.json(
      {
        error: "QUOTA_EXHAUSTED",
        message: `Vous avez atteint le nombre maximum de caractères traductibles. Réinitialisation le ${formatted}.`,
        remaining: preStatus.totalRemaining,
        resetDate: preStatus.resetDate,
      },
      { status: 429 }
    );
  }

  try {
    const translations = await translateToAllLocales(text);
    const postStatus = await getTranslationQuotaStatus();

    return NextResponse.json({
      translations,
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
          message: `Vous avez atteint le nombre maximum de caractères traductibles. Réinitialisation le ${formatted}.`,
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
