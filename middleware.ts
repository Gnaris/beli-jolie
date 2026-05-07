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
// Seuls les SUCCÈS sont mis en cache 60s. Les erreurs ne sont PAS cachées :
// au démarrage de l'app, l'API peut ne pas être prête sur la 1re requête —
// si on cachait l'erreur 60s, le site resterait bloqué en maintenance pendant
// 1 min après chaque (re)démarrage. Mieux vaut retenter à chaque hit jusqu'à
// avoir un vrai succès, puis cacher 60s.
let maintenanceCache: { value: boolean; timestamp: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function getMaintenanceStatus(requestUrl: string): Promise<boolean> {
  if (process.env.NODE_ENV === "development") return false;

  const now = Date.now();
  if (maintenanceCache && now - maintenanceCache.timestamp < CACHE_TTL_MS) {
    return maintenanceCache.value;
  }
  // Auto-appel HTTP en local : on cible explicitement 127.0.0.1:3000 plutôt
  // que de reconstruire à partir de `requestUrl`. Derrière un reverse proxy
  // (nginx → port 3000), `request.url` peut donner `https://localhost:3000`,
  // qui échoue car Next.js n'écoute pas en HTTPS sur ce port. Le fail-safe
  // bascule alors le site en maintenance à tort.
  const internalPort = process.env.PORT || "3000";
  const fetchUrl = `http://127.0.0.1:${internalPort}/api/site-status`;
  try {
    // `cache: "no-store"` : on évite la Data Cache de Next.js (sur disque)
    // qui peut survivre aux rebuilds et garder une vieille réponse "maintenance"
    // pendant 60s. On garde uniquement le cache mémoire `maintenanceCache`
    // ci-dessus, qui est réinitialisé à chaque redémarrage du process.
    const res = await fetch(fetchUrl, { cache: "no-store" });
    if (!res.ok) {
      // Fail-safe : on retourne true SANS cacher, pour retenter au prochain hit.
      return true;
    }
    const data = (await res.json()) as { maintenance: boolean };
    maintenanceCache = { value: !!data.maintenance, timestamp: now };
    return maintenanceCache.value;
  } catch {
    // Idem : pas de cache sur l'erreur, on retentera.
    return true;
  }
}

/**
 * Middleware combiné :
 * 1. Routes système (admin, api, maintenance, sitemap…) → pas de locale, auth classique
 * 2. Routes publiques → préfixe locale obligatoire (/fr/, /en/, etc.). next-intl gère la
 *    redirection des anciennes URLs (sans préfixe) vers la locale par défaut.
 * 3. Logique d'auth (admin, client, pending, maintenance) appliquée sur le `rest`
 *    (path sans préfixe locale) pour rester lisible.
 *
 * Visibilité des prix : tout le monde peut accéder à la home, aux fiches produit,
 * aux collections et aux catégories. Le masquage des prix est géré côté composants
 * via `lib/price-visibility.ts` — pas via une redirection middleware.
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

  // ── 2. Si la route DOIT être localisée, on passe TOUJOURS par next-intl
  //      pour qu'il pose le header `X-NEXT-INTL-LOCALE` sur la request rewrite.
  //      Sans ça, getLocale() côté serveur retourne toujours la locale par
  //      défaut et les <Link> côté client génèrent des URL en /fr même quand
  //      le visiteur navigue sur /en, /de, etc.
  let intlResponse: NextResponse | null = null;
  if (!isUnlocalized) {
    intlResponse = intlMiddleware(request) as NextResponse;
    // intlMiddleware peut renvoyer une 30x (legacy URL → URL avec préfixe).
    // Dans ce cas, on respecte sa décision et on s'arrête.
    if (intlResponse.headers.get("location")) {
      return intlResponse;
    }
  }

  // Helper : retourne une "next response" qui conserve les headers posés par
  // next-intl (locale, cookies de détection éventuels, etc.).
  const passThrough = () => intlResponse ?? NextResponse.next();

  // ── 3. À ce stade : soit la route est unlocalized (admin/api), soit elle a déjà un préfixe
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const isAdmin = token?.role === "ADMIN";
  const isPending = token?.status === "PENDING";
  const previewMode = request.cookies.get("bj_admin_preview")?.value === "1";

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
    return passThrough();
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
    return passThrough();
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
    return passThrough();
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
      const response = passThrough();
      response.cookies.set("bj_admin_preview", "1", { path: "/", httpOnly: false, sameSite: "lax", maxAge: 8 * 3600 });
      return response;
    }
    return passThrough();
  }

  // ── Pages légales — public sans auth ──────────────────────────────────────
  if (
    rest.startsWith("/mentions-legales") ||
    rest.startsWith("/cgv") ||
    rest.startsWith("/cgu") ||
    rest.startsWith("/confidentialite") ||
    rest.startsWith("/cookies")
  ) {
    return passThrough();
  }

  // ── Routes publiques (home, produits, collections, catégories) ───────────
  // Accessibles à tous les visiteurs, connectés ou non. Les prix sont
  // masqués côté affichage tant que le compte n'est pas APPROVED par l'admin
  // (cf. lib/price-visibility.ts + composants ProductCard / ProductDetail).
  return passThrough();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|html)$).*)",
  ],
};
