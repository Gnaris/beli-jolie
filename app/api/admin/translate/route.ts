import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { translateToAllLocales } from "@/lib/translate";

/**
 * POST /api/admin/translate
 * Body: { text: string }
 * Returns: { translations: Record<locale, string> }
 *
 * GET /api/admin/translate
 * Returns: { remaining: number } — compat (PFS n'a pas de quota au caractère).
 */

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  return NextResponse.json({
    remaining: Number.MAX_SAFE_INTEGER,
    resetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
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

  try {
    const translations = await translateToAllLocales(text);
    return NextResponse.json({
      translations,
      remaining: Number.MAX_SAFE_INTEGER,
    });
  } catch {
    return NextResponse.json(
      { error: "Erreur lors de la traduction" },
      { status: 500 }
    );
  }
}
