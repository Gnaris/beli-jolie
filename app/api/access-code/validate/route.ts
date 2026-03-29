import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/access-code/validate
 *
 * Valide un code d'accès invité.
 * Si valide : retourne success + set cookie bj_access_code (7 jours)
 * Si invalide/expiré/utilisé : retourne erreur
 */
export async function POST(request: NextRequest) {
  // Rate limit : 10 req/min par IP (protection brute force)
  const rateLimited = checkRateLimit(request, "access-code-validate", 10, 60_000);
  if (rateLimited) return rateLimited;

  try {
    const { code } = (await request.json()) as { code?: string };

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Code requis." }, { status: 400 });
    }

    const trimmed = code.trim().toUpperCase();

    const accessCode = await prisma.accessCode.findUnique({
      where: { code: trimmed },
    });

    if (!accessCode) {
      return NextResponse.json({ error: "Code d'accès invalide." }, { status: 404 });
    }

    if (!accessCode.isActive) {
      return NextResponse.json({ error: "Ce code d'accès a été désactivé." }, { status: 403 });
    }

    if (new Date() > accessCode.expiresAt) {
      return NextResponse.json({ error: "Ce code d'accès a expiré." }, { status: 403 });
    }

    if (accessCode.usedBy) {
      return NextResponse.json({ error: "Ce code d'accès a déjà été utilisé pour une inscription." }, { status: 403 });
    }

    // Update access timestamps in a single query
    const now = new Date();
    await prisma.accessCode.update({
      where: { id: accessCode.id },
      data: {
        ...(!accessCode.firstAccessAt ? { firstAccessAt: now } : {}),
        lastAccessAt: now,
      },
    });

    // Préparer les données de pré-remplissage (si l'admin les a renseignées)
    const prefill: Record<string, string> = {};
    if (accessCode.prefillFirstName) prefill.firstName = accessCode.prefillFirstName;
    if (accessCode.prefillLastName)  prefill.lastName  = accessCode.prefillLastName;
    if (accessCode.prefillCompany)   prefill.company   = accessCode.prefillCompany;
    if (accessCode.prefillEmail)     prefill.email     = accessCode.prefillEmail;
    if (accessCode.prefillPhone)     prefill.phone     = accessCode.prefillPhone;

    // Set cookie et retourner success
    const response = NextResponse.json({
      success: true,
      code: trimmed,
      ...(Object.keys(prefill).length > 0 ? { prefill } : {}),
    });
    response.cookies.set("bj_access_code", trimmed, {
      httpOnly: false, // accessible côté client pour le tracking
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 jours
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[POST /api/access-code/validate]", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
