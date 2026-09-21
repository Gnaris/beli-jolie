import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkSiret, normalizeSiret } from "@/lib/siret";

/**
 * GET /api/admin/siret-check?siret=12345678900012
 * Vérifie un SIRET auprès de l'API Recherche d'entreprises (INSEE).
 * Résultat live, non persisté.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("siret")?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "Paramètre 'siret' manquant." }, { status: 400 });
  }

  const normalized = normalizeSiret(raw);
  if (!normalized) {
    return NextResponse.json(
      { error: "Format invalide : le SIRET doit contenir 14 chiffres." },
      { status: 400 },
    );
  }

  const result = await checkSiret(normalized);
  return NextResponse.json(result, { status: 200 });
}
