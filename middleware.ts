import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware de protection des routes — Beli & Jolie
 *
 * Règles :
 * - /admin/*      → réservé aux ADMIN (redirect → /connexion si non admin)
 * - /boutique/*   → réservé aux CLIENT et ADMIN approuvés
 * - /connexion    → redirige vers / si déjà connecté
 * - /inscription  → redirige vers / si déjà connecté
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Récupération du token JWT (null si non connecté)
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const isAdmin = token?.role === "ADMIN";

  // ── Routes publiques uniquement si NON connecté ────────────────────
  if (pathname.startsWith("/connexion") || pathname.startsWith("/inscription")) {
    if (isAuthenticated) {
      // Redirige selon le rôle
      const redirectTo = isAdmin ? "/admin" : "/";
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
    return NextResponse.next();
  }

  // ── Routes admin ────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (!isAdmin) {
      // Connecté mais pas admin → page d'accueil
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  // ── Espace pro client ────────────────────────────────────────────────
  if (pathname.startsWith("/espace-pro")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    // Un admin redirigé vers son panel
    if (isAdmin) return NextResponse.redirect(new URL("/admin", request.url));
    return NextResponse.next();
  }

  // ── Routes produits + commandes (protégées) ──────────────────────────
  if (pathname.startsWith("/produits") || pathname.startsWith("/commandes")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/espace-pro/:path*",
    "/produits/:path*",
    "/commandes/:path*",
    "/connexion",
    "/inscription",
  ],
};
