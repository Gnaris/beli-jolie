import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { validateCartForUser } from "@/lib/cart-validation";

/**
 * POST /api/cart/validate
 *
 * Vérifie que TOUS les articles du panier de l'utilisateur courant sont
 * vendables MAINTENANT : produit encore ONLINE + stock suffisant. Appelée par
 * le front à chaque transition sensible :
 *  - clic « Passer commande » sur /panier,
 *  - mount de /panier/commande,
 *  - transition étape 1 → étape 2 du wizard commande,
 *  - juste avant le clic « Payer » (indirectement via create-intent).
 *
 * Retourne 200 dans TOUS les cas — le front lit `ok` et `errors`. On garde
 * 200 pour ne pas déclencher de comportement d'erreur générique côté navigateur.
 */
export async function POST(req: Request) {
  const rateLimited = checkRateLimit(req, "cart-validate", 30, 60_000);
  if (rateLimited) return rateLimited;

  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  const result = await validateCartForUser(session.user.id);
  return NextResponse.json(result);
}
