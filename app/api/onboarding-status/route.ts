/**
 * Endpoint public non-authentifie qui indique si l'onboarding wizard a ete
 * termine sur cette boutique. Consomme uniquement par le middleware edge
 * (qui ne peut pas lire la BDD directement) avec un cache memoire 60s.
 *
 * Retourne { completed: boolean }. Aucune donnee sensible.
 */
import { NextResponse } from "next/server";
import { isOnboardingCompleted } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const completed = await isOnboardingCompleted();
    return NextResponse.json({ completed }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    // Fail-safe : si on n'arrive pas a lire la BDD, on repond "completed=true"
    // pour ne pas bloquer une boutique existante en cas d'incident temporaire.
    return NextResponse.json({ completed: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
