import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkVies, parseVatNumber } from "@/lib/vies";

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

  const parsed = parseVatNumber(raw);
  if (!parsed) {
    return NextResponse.json(
      { error: "Format invalide : 2 lettres de pays + numéro (ex: BE0506978319)." },
      { status: 400 }
    );
  }

  const result = await checkVies(raw);

  // Sauvegarde en DB si userId fourni
  const userId = request.nextUrl.searchParams.get("userId");
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
