import createIntlMiddleware from "next-intl/middleware";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const LOCALE_PATTERN = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

function stripLocale(pathname: string): { locale: string; rest: string } {
  const match = pathname.match(LOCALE_PATTERN);
  if (match) {
    const locale = match[1];
    const rest = pathname.slice(match[0].length) || "/";
    return { locale, rest };
  }
  return { locale: routing.defaultLocale, rest: pathname };
}

function localeUrl(locale: string, path: string, request: NextRequest): URL {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`/${locale}${safePath === "/" ? "" : safePath}`, request.url);
}

// ── Cache maintenance status (module-level, resets every ~60s) ──────────────
let maintenanceCache: { value: boolean; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function getMaintenanceStatus(requestUrl: string): Promise<boolean> {
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
    maintenanceCache = { value: true, timestamp: now };
    return true;
  }
}

/**
 * Middleware combiné :
 * 1. Routes système (admin, api, maintenance, sitemap…) → pas de locale, auth classique
 * 2. Routes publiques → préfixe locale obligatoire (/fr/, /en/, etc.). next-intl gère la
 *    redirection des anciennes URLs (sans préfixe) vers la locale par défaut.
 * 3. Logique d'auth (admin, client, pending, codes accès, maintenance) appliquée
 *    sur le `rest` (path sans préfixe locale) pour rester lisible.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 1. Routes 100% hors i18n ──────────────────────────────────────────────
  const isUnlocalized =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api") ||
    pathname === "/maintenance" ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname.startsWith("/_next");

  // ── 2. Si la route DOIT être localisée et ne l'est pas, déléguer à next-intl
  //      pour qu'il redirige (ex: /produits → /fr/produits)
  if (!isUnlocalized && !LOCALE_PATTERN.test(pathname)) {
    return intlMiddleware(request);
  }

  // ── 3. À ce stade : soit la route est unlocalized (admin/api), soit elle a déjà un préfixe
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const isAdmin = token?.role === "ADMIN";
  const isPending = token?.status === "PENDING";
  const previewMode = request.cookies.get("bj_admin_preview")?.value === "1";
  const hasAccessCode = !!request.cookies.get("bj_access_code")?.value;

  // Path "sans locale" pour matcher la logique métier (vide = "/")
  const { locale, rest } = stripLocale(pathname);

  // ── Maintenance ───────────────────────────────────────────────────────────
  const bypassMaintenance =
    pathname === "/maintenance" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/site-status") ||
    rest.startsWith("/connexion") ||
    rest.startsWith("/inscription") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/access-code") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/cart") ||
    rest.startsWith("/mentions-legales") ||
    rest.startsWith("/cgv") ||
    rest.startsWith("/cgu") ||
    rest.startsWith("/confidentialite") ||
    rest.startsWith("/cookies") ||
    pathname.startsWith("/api/legal") ||
    rest.startsWith("/catalogue");

  if (!bypassMaintenance) {
    const inMaintenance = await getMaintenanceStatus(request.url);
    if (inMaintenance && !isAdmin) {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  // ── Routes auth publiques uniquement si NON connecté ──────────────────────
  if (rest.startsWith("/connexion") || rest.startsWith("/inscription")) {
    if (isAuthenticated) {
      const target = isAdmin ? "/admin" : isPending ? "/espace-pro" : "/";
      const url = isAdmin ? new URL("/admin", request.url) : localeUrl(locale, target, request);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── PENDING : limité à l'espace perso ─────────────────────────────────────
  if (isAuthenticated && isPending && !isAdmin) {
    const pendingAllowed =
      rest.startsWith("/espace-pro") ||
      pathname.startsWith("/api/auth") ||
      pathname.startsWith("/api/site-status") ||
      pathname === "/maintenance" ||
      rest.startsWith("/mentions-legales") ||
      rest.startsWith("/cgv") ||
      rest.startsWith("/cgu") ||
      rest.startsWith("/confidentialite") ||
      rest.startsWith("/cookies") ||
      pathname.startsWith("/api/legal");
    if (!pendingAllowed) {
      return NextResponse.redirect(localeUrl(locale, "/espace-pro", request));
    }
    return NextResponse.next();
  }

  // ── Admin ────────────────────────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (!isAuthenticated) {
      const loginUrl = localeUrl(routing.defaultLocale, "/connexion", request);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (!isAdmin) {
      return NextResponse.redirect(localeUrl(routing.defaultLocale, "/", request));
    }
    return NextResponse.next();
  }

  // ── Espace pro / panier / favoris / commandes (auth requis) ───────────────
  const protectedClient = ["/espace-pro", "/panier", "/favoris", "/commandes"];
  if (protectedClient.some((p) => rest.startsWith(p))) {
    if (!isAuthenticated) {
      const loginUrl = localeUrl(locale, "/connexion", request);
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

  // ── Pages légales — public sans auth ──────────────────────────────────────
  if (
    rest.startsWith("/mentions-legales") ||
    rest.startsWith("/cgv") ||
    rest.startsWith("/cgu") ||
    rest.startsWith("/confidentialite") ||
    rest.startsWith("/cookies")
  ) {
    return NextResponse.next();
  }

  // ── Routes publiques avec code d'accès invité ─────────────────────────────
  if (
    rest === "/" ||
    rest.startsWith("/produits") ||
    rest.startsWith("/collections") ||
    rest.startsWith("/categories")
  ) {
    if (!isAuthenticated && !hasAccessCode) {
      const loginUrl = localeUrl(locale, "/connexion", request);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
