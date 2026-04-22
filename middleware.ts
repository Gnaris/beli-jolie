import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

/**
 * Middleware de protection des routes
 *
 * Règles :
 * - /admin/*      → réservé aux ADMIN (redirect → /connexion si non admin)
 * - /boutique/*   → réservé aux CLIENT et ADMIN approuvés
 * - /connexion    → redirige vers / si déjà connecté
 * - /inscription  → redirige vers / si déjà connecté
 * - maintenance   → redirige toutes les routes vers /maintenance sauf admin/auth
 */

// ── Cache maintenance status (module-level, resets every ~60s) ──────────────
// Higher TTL = fewer internal HTTP calls under 100k visitors
let maintenanceCache: { value: boolean; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function getMaintenanceStatus(requestUrl: string): Promise<boolean> {
  // Skip maintenance check in development — the self-referential fetch goes
  // through the dev compiler, adding 500ms-2s per navigation.
  if (process.env.NODE_ENV === "development") return false;

  const now = Date.now();
  if (maintenanceCache && now - maintenanceCache.timestamp < CACHE_TTL_MS) {
    return maintenanceCache.value;
  }
  try {
    const res = await fetch(new URL("/api/site-status", requestUrl).toString(), {
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      maintenanceCache = { value: true, timestamp: now };
      return true;
    }
    const data = (await res.json()) as { maintenance: boolean };
    maintenanceCache = { value: !!data.maintenance, timestamp: now };
    return maintenanceCache.value;
  } catch {
    // On failure, assume maintenance — if the status endpoint is down,
    // something is critically wrong (DB down, server error, etc.)
    maintenanceCache = { value: true, timestamp: now };
    return true;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Récupération du token JWT (null si non connecté)
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const isAdmin = token?.role === "ADMIN";
  const isPending = token?.status === "PENDING";
  const previewMode = request.cookies.get("bj_admin_preview")?.value === "1";
  const hasAccessCode = !!request.cookies.get("bj_access_code")?.value;

  // ── Maintenance mode ────────────────────────────────────────────────
  // Always bypass: /maintenance itself, /admin/*, /api/site-status, auth pages
  const bypassMaintenance =
    pathname === "/maintenance" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/site-status") ||
    pathname.startsWith("/connexion") ||
    pathname.startsWith("/inscription") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/access-code") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/heartbeat") ||
    pathname.startsWith("/api/cart") ||
    pathname.startsWith("/mentions-legales") ||
    pathname.startsWith("/cgv") ||
    pathname.startsWith("/cgu") ||
    pathname.startsWith("/confidentialite") ||
    pathname.startsWith("/cookies") ||
    pathname.startsWith("/api/legal") ||
    pathname.startsWith("/catalogue");

  if (!bypassMaintenance) {
    const inMaintenance = await getMaintenanceStatus(request.url);
    if (inMaintenance && !isAdmin) {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  // ── Routes publiques uniquement si NON connecté ────────────────────
  if (pathname.startsWith("/connexion") || pathname.startsWith("/inscription")) {
    if (isAuthenticated) {
      // Redirige selon le rôle / statut
      const redirectTo = isAdmin ? "/admin" : isPending ? "/espace-pro" : "/";
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }
    return NextResponse.next();
  }

  // ── Comptes PENDING : limités à l'espace perso ─────────────────────
  // Peuvent se connecter, voir leur compte, modifier leurs infos
  // mais ne peuvent pas accéder au catalogue / panier / commandes.
  if (isAuthenticated && isPending && !isAdmin) {
    const pendingAllowed =
      pathname.startsWith("/espace-pro") ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/site-status") ||
      pathname.startsWith("/maintenance") ||
      pathname.startsWith("/mentions-legales") ||
      pathname.startsWith("/cgv") ||
      pathname.startsWith("/cgu") ||
      pathname.startsWith("/confidentialite") ||
      pathname.startsWith("/cookies") ||
      pathname.startsWith("/api/legal");
    if (!pendingAllowed) {
      return NextResponse.redirect(new URL("/espace-pro", request.url));
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
    if (isAdmin && !previewMode) {
      // Set preview cookie automatically for admin accessing client routes
      const response = NextResponse.next();
      response.cookies.set("bj_admin_preview", "1", { path: "/", httpOnly: false, sameSite: "lax", maxAge: 8 * 3600 });
      return response;
    }
    return NextResponse.next();
  }

  // ── Panier ──────────────────────────────────────────────────────────
  if (pathname.startsWith("/panier")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (isAdmin && !previewMode) {
      const response = NextResponse.next();
      response.cookies.set("bj_admin_preview", "1", { path: "/", httpOnly: false, sameSite: "lax", maxAge: 8 * 3600 });
      return response;
    }
    return NextResponse.next();
  }

  // ── Pages légales — accessibles à tous sans authentification ──────
  if (
    pathname.startsWith("/mentions-legales") ||
    pathname.startsWith("/cgv") ||
    pathname.startsWith("/cgu") ||
    pathname.startsWith("/confidentialite") ||
    pathname.startsWith("/cookies")
  ) {
    return NextResponse.next();
  }

  // ── Routes publiques accessibles avec code d'accès invité ──────────
  if (
    pathname === "/" ||
    pathname.startsWith("/produits") ||
    pathname.startsWith("/collections") ||
    pathname.startsWith("/categories")
  ) {
    if (!isAuthenticated && !hasAccessCode) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // ── Favoris (protégé, inscription obligatoire) ─────────────────────
  if (pathname.startsWith("/favoris")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (isAdmin && !previewMode) {
      const response = NextResponse.next();
      response.cookies.set("bj_admin_preview", "1", { path: "/", httpOnly: false, sameSite: "lax", maxAge: 8 * 3600 });
      return response;
    }
    return NextResponse.next();
  }

  // ── Routes commandes (protégées, inscription obligatoire) ──────────
  if (pathname.startsWith("/commandes")) {
    if (!isAuthenticated) {
      const loginUrl = new URL("/connexion", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (isAdmin && !previewMode) {
      const response = NextResponse.next();
      response.cookies.set("bj_admin_preview", "1", { path: "/", httpOnly: false, sameSite: "lax", maxAge: 8 * 3600 });
      return response;
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files and images.
     * This allows the maintenance check to run on all pages.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
