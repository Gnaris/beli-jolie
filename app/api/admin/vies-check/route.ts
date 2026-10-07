import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkVies } from "@/lib/vies";

/**
 * GET /api/admin/vies-check?vat=BE0506978319&userId=xxx
 *
 * Vérifie un numéro de TVA via VIES et sauvegarde le résultat en DB
 * si un userId est fourni (bouton "Relancer" côté admin).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès non autorisé." }, { status: 401 });
  }

  const raw = request.nextUrl.searchParams.get("vat")?.trim().toUpperCase() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "Paramètre 'vat' manquant." }, { status: 400 });
  }

  const userId = request.nextUrl.searchParams.get("userId");

  // Beaucoup de clients UE oublient les 2 lettres de code pays devant leur
  // numéro de TVA. Si l'entrée ne commence pas par 2 lettres, on complète
  // automatiquement avec le pays d'adresse du client — VIES peut alors
  // répondre. On lance la vérification dans tous les cas (le résultat
  // "format invalide" éventuel est remonté par VIES lui-même).
  const cleaned = raw.replace(/[^A-Z0-9]/g, "");
  const hasCountryPrefix = /^[A-Z]{2}/.test(cleaned);
  let vatToCheck = cleaned;

  if (!hasCountryPrefix && userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { addressCountry: true },
    }).catch(() => null);
    if (user?.addressCountry) {
      vatToCheck = user.addressCountry.toUpperCase() + cleaned;
    }
  }

  const result = await checkVies(vatToCheck);

  // Sauvegarde en DB si userId fourni
  if (userId) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        viesValid: result.valid,
        viesName: result.name,
        viesAddress: result.address,
        viesRequestDate: result.requestDate,
        viesError: result.serviceError ?? null,
      },
    }).catch(() => {
      // Non bloquant — le résultat est quand même renvoyé au client
    });
  }

  return NextResponse.json(result, { status: 200 });
}
