import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/vies?vat=FR12345678901
 *
 * Valide un numéro de TVA intracommunautaire via l'API officielle VIES
 * de la Commission Européenne.
 *
 * Retourne :
 * - { valid: true, name, address, countryCode, vatNumber }
 * - { valid: false, error }
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ valid: false, error: "Non authentifié." }, { status: 401 });

  const vatParam = request.nextUrl.searchParams.get("vat");
  if (!vatParam || vatParam.length < 4) {
    return NextResponse.json({ valid: false, error: "Numéro TVA manquant." }, { status: 400 });
  }

  // Séparer le code pays (2 lettres) du numéro
  const countryCode = vatParam.slice(0, 2).toUpperCase();
  const vatNumber   = vatParam.slice(2).replace(/\s/g, "").toUpperCase();

  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return NextResponse.json({ valid: false, error: "Code pays invalide." }, { status: 400 });
  }

  try {
    const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 }, // pas de cache
    });

    if (!res.ok) {
      return NextResponse.json(
        { valid: false, error: "Service VIES temporairement indisponible." },
        { status: 502 }
      );
    }

    const data = await res.json();

    return NextResponse.json({
      valid:       data.isValid === true,
      name:        data.name ?? null,
      address:     data.address ?? null,
      countryCode: data.countryCode ?? countryCode,
      vatNumber:   data.vatNumber ?? vatNumber,
    });
  } catch {
    return NextResponse.json(
      { valid: false, error: "Impossible de contacter le service VIES." },
      { status: 503 }
    );
  }
}
