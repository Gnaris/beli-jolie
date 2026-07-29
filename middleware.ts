import createIntlMiddleware from "next-intl/middleware";
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { isPreOnboardingAllowed } from "@/lib/onboarding-gating";
export { isPreOnboardingAllowed } from "@/lib/onboarding-gating";

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
// Multi-tenant : un cache par tenantId (clé "no-tenant" pour les requêtes hors
// contexte boutique). Sans ça, l'état maintenance ou onboarding d'une boutique
// s'appliquait à toutes.
const maintenanceCache = new Map<string, { value: boolean; timestamp: number }>();
const onboardingCache = new Map<string, { completed: boolean; timestamp: number }>();
const CACHE_TTL_MS = 60_000;

// Cache in-memory host → tenant (5 min TTL car les mappings changent peu).
// En dev local (localhost), on peuple ce cache très vite ; en prod, chaque
// domaine cliente vit ici après le 1er hit.
type TenantMapping = { id: string; slug: string; name: string } | { unknown: true };
const tenantCache = new Map<string, { value: TenantMapping; timestamp: number }>();
const TENANT_CACHE_TTL_MS = 5 * 60_000;

// En dev, si le host n'est pas mappé (ex: IP LAN 192.168.x.x depuis mobile),
// on retombe sur le tenant enregistré pour "localhost" — déjà configuré dans
// TenantDomain sur toute install de dev. Évite de coder un slug en dur.
const DEV_FALLBACK_HOST = "localhost";

async function resolveTenantForHost(host: string, requestUrl: string): Promise<TenantMapping> {
  const key = host.toLowerCase();
  const now = Date.now();
  const cached = tenantCache.get(key);
  if (cached && now - cached.timestamp < TENANT_CACHE_TTL_MS) {
    return cached.value;
  }
  const internalPort = process.env.PORT || "3000";
  const fetchUrl = `http://127.0.0.1:${internalPort}/api/tenant-by-host?host=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(fetchUrl, { cache: "no-store" });
    if (res.status === 404) {
      // En dev, un domaine inconnu (ex: 192.168.x.x depuis mobile sur LAN)
      // retombe sur le tenant mappé à "localhost" — sinon l'admin plante avec
      // "Aucun tenant résolu". En prod, on garde `unknown` → 404.
      if (process.env.NODE_ENV === "development" && key !== DEV_FALLBACK_HOST) {
        const fallback = await resolveTenantForHost(DEV_FALLBACK_HOST, requestUrl);
        if (!("unknown" in fallback)) {
          tenantCache.set(key, { value: fallback, timestamp: now });
          return fallback;
        }
      }
      const value: TenantMapping = { unknown: true };
      tenantCache.set(key, { value, timestamp: now });
      return value;
    }
    if (!res.ok) {
      // BDD injoignable ou autre 5xx : ne pas cacher, retenter au prochain hit.
      return { unknown: true };
    }
    const data = (await res.json()) as { tenantId: string; slug: string; name: string };
    const value: TenantMapping = { id: data.tenantId, slug: data.slug, name: data.name };
    tenantCache.set(key, { value, timestamp: now });
    return value;
  } catch {
    // Idem : pas de cache sur exception.
    return { unknown: true };
  }
}

async function getOnboardingCompleted(_requestUrl: string, tenantId: string | null): Promise<boolean> {
  const key = tenantId ?? "no-tenant";
  const now = Date.now();
  const cached = onboardingCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.completed;
  }
  const internalPort = process.env.PORT || "3000";
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const fetchUrl = `http://127.0.0.1:${internalPort}/api/onboarding-status${qs}`;
  try {
    const res = await fetch(fetchUrl, { cache: "no-store" });
    if (!res.ok) {
      // Fail-safe : on considere l'onboarding fait pour ne pas bloquer une
      // boutique existante en cas d'incident. On retente au prochain hit.
      return true;
    }
    const data = (await res.json()) as { completed: boolean };
    onboardingCache.set(key, { completed: !!data.completed, timestamp: now });
    return !!data.completed;
  } catch {
    return true;
  }
}


async function getMaintenanceStatus(requestUrl: string, tenantId: string | null): Promise<boolean> {
  if (process.env.NODE_ENV === "development") return false;

  const key = tenantId ?? "no-tenant";
  const now = Date.now();
  const cached = maintenanceCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.value;
  }
  // Auto-appel HTTP en local : on cible explicitement 127.0.0.1:3000 plutôt
  // que de reconstruire à partir de `requestUrl`. Derrière un reverse proxy
  // (nginx → port 3000), `request.url` peut donner `https://localhost:3000`,
  // qui échoue car Next.js n'écoute pas en HTTPS sur ce port. Le fail-safe
  // bascule alors le site en maintenance à tort.
  const internalPort = process.env.PORT || "3000";
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
  const fetchUrl = `http://127.0.0.1:${internalPort}/api/site-status${qs}`;
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
    maintenanceCache.set(key, { value: !!data.maintenance, timestamp: now });
    return !!data.maintenance;
  } catch {
    // Idem : pas de cache sur l'erreur, on retentera.
    return true;
  }
}

/**
 * Liste des chemins qui ignorent l'auto-maintenance.
 *
 * Le webhook Ankorstore (et tout `/api/webhooks/*`) doit pouvoir ACK son
 * callback même quand `/api/site-status` retourne `maintenance: true`. Sinon
 * le middleware redirige le POST en 307 vers `/maintenance` ; les émetteurs
 * (Guzzle côté Ankorstore, Stripe webhook, …) ne suivent pas la redirection
 * POST et l'opération reste figée en PENDING côté BDD (callback perdu).
 */
export function isMaintenanceBypassed(pathname: string, rest: string): boolean {
  return (
    pathname === "/maintenance" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/site-status") ||
    rest.startsWith("/connexion") ||
    rest.startsWith("/inscription") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/cart") ||
    pathname.startsWith("/api/webhooks") ||
    rest.startsWith("/mentions-legales") ||
    rest.startsWith("/cgv") ||
    rest.startsWith("/cgu") ||
    rest.startsWith("/confidentialite") ||
    rest.startsWith("/cookies") ||
    pathname.startsWith("/api/legal") ||
    rest.startsWith("/catalogue")
  );
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

  // ── 0.a Court-circuit pour les endpoints internes appelés par le middleware
  //         lui-même (tenant-by-host, site-status, onboarding-status). Sans ce
  //         court-circuit, chaque fetch interne déclenche à nouveau le
  //         middleware qui refait 3 fetch → explosion exponentielle
  //         (2+ min par requête externe observés).
  const isInternalMiddlewareCall =
    pathname.startsWith("/api/tenant-by-host") ||
    pathname.startsWith("/api/site-status") ||
    pathname.startsWith("/api/onboarding-status");
  if (isInternalMiddlewareCall) {
    return NextResponse.next();
  }

  // ── 0.b Résolution multi-tenant (host → boutique) ──────────────────────────
  // Le middleware pose x-tenant-id / x-tenant-slug / x-tenant-name sur la
  // request rewrite ; server components, server actions et API routes lisent
  // ces headers via `lib/tenant.ts::getCurrentTenant()`.
  //
  // On saute la résolution pour l'endpoint interne `/api/tenant-by-host` (sinon
  // boucle infinie) et pour les assets Next.
  const host = (request.headers.get("host") || "").toLowerCase();
  // Sitemap et robots.txt DOIVENT être scopés par tenant — chaque boutique
  // a son propre sitemap. On garde la résolution active pour eux.
  const skipTenantResolution =
    pathname.startsWith("/api/tenant-by-host") ||
    pathname.startsWith("/_next");

  // Chemins qui contournent la vérification "host inconnu" — ils doivent rester
  // joignables même depuis un domaine non enregistré (webhooks marketplaces,
  // callbacks Stripe, endpoints d'auth qui n'ont pas encore de tenant, etc).
  const isTenantVerificationBypassed =
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/internal") ||
    pathname.startsWith("/api/heartbeat") ||
    pathname.startsWith("/api/report-error");

  let tenantHeaders: Record<string, string> = {};
  if (!skipTenantResolution && host) {
    const tenant = await resolveTenantForHost(host, request.url);
    if ("unknown" in tenant) {
      // Domaine non enregistré. Le fail-open (laisser passer sans header) est
      // une vulnérabilité : les routes publiques sans requireCurrentTenant()
      // renvoient les données GLOBALES au lieu de scoper par boutique.
      // → En prod, on renvoie 404 sauf pour les chemins bypass ci-dessus.
      // → En dev, on log et on laisse passer pour faciliter les tests locaux.
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[middleware] Host inconnu ${host} et fallback dev "${DEV_FALLBACK_HOST}" introuvable — pas de tenant résolu`
        );
      } else if (!isTenantVerificationBypassed) {
        return new NextResponse("Boutique introuvable pour ce domaine.", {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        });
      }
    } else {
      tenantHeaders = {
        "x-tenant-id": tenant.id,
        "x-tenant-slug": tenant.slug,
        "x-tenant-name": tenant.name,
      };
    }
  }

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

  // Injecte les headers tenant dans la request rewrite, pour que server
  // components + server actions puissent les relire via `next/headers`.
  const requestHeadersWithTenant = new Headers(request.headers);
  for (const [k, v] of Object.entries(tenantHeaders)) {
    requestHeadersWithTenant.set(k, v);
  }

  // Helper : retourne une "next response" qui conserve les headers posés par
  // next-intl (locale, cookies de détection éventuels, etc.), avec en plus
  // les headers tenant injectés sur la request rewrite.
  //
  // IMPORTANT : intlResponse contient déjà un rewrite (x-middleware-rewrite)
  // vers le path avec locale. On DOIT ré-injecter les tenant headers sur cette
  // request rewrite, sinon les pages localisées ne voient pas le tenant et
  // toute la BDD lue par server components devient un mélange cross-tenant.
  const passThrough = () => {
    if (intlResponse) {
      // Copie la response next-intl mais force x-middleware-override-headers
      // pour que Next.js ajoute nos tenant headers sur la request forwardée
      // aux server components.
      for (const [k, v] of Object.entries(tenantHeaders)) {
        intlResponse.headers.set(`x-middleware-request-${k}`, v);
      }
      if (Object.keys(tenantHeaders).length > 0) {
        const existing = intlResponse.headers.get("x-middleware-override-headers");
        const newHeaders = Object.keys(tenantHeaders).join(",");
        intlResponse.headers.set(
          "x-middleware-override-headers",
          existing ? `${existing},${newHeaders}` : newHeaders,
        );
      }
      return intlResponse;
    }
    return NextResponse.next({ request: { headers: requestHeadersWithTenant } });
  };

  // ── 3. À ce stade : soit la route est unlocalized (admin/api), soit elle a déjà un préfixe
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Un token marqué `deleted` correspond à un utilisateur supprimé en BDD :
  // on le traite comme une session inexistante, sinon le cookie JWT (valide 30j)
  // permettrait à un compte supprimé de continuer à naviguer.
  const isAuthenticated = !!token && !token.deleted;
  const isAdmin = isAuthenticated && token?.role === "ADMIN";
  const isPending = isAuthenticated && token?.status === "PENDING";
  const previewMode = request.cookies.get("bj_admin_preview")?.value === "1";

  // Path "sans locale" pour matcher la logique métier (vide = "/")
  const { locale, rest } = stripLocale(pathname);

  // ── Onboarding gate ───────────────────────────────────────────────────────
  // Tant que l'admin n'a pas termine (ou skippe) le wizard, la boutique n'est
  // pas visible pour les visiteurs et les URL client sont invalides. Seuls
  // sont accessibles : /connexion, /api/auth, /admin/bienvenue (pour l'admin).
  const onboardingBypassed =
    isPreOnboardingAllowed(pathname, rest) ||
    pathname.startsWith("/admin/bienvenue"); // wizard lui-meme

  // tenantId courant pour scoper les checks maintenance/onboarding par boutique.
  const currentTenantId = tenantHeaders["x-tenant-id"] ?? null;

  if (!onboardingBypassed) {
    const onboardingDone = await getOnboardingCompleted(request.url, currentTenantId);
    if (!onboardingDone) {
      // Admin authentifie : direction wizard
      if (isAdmin) {
        return NextResponse.redirect(new URL("/admin/bienvenue", request.url));
      }
      // Visiteur non-admin (ou non-connecte) : direction login
      const loginUrl = localeUrl(routing.defaultLocale, "/connexion", request);
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── Maintenance ───────────────────────────────────────────────────────────
  if (!isMaintenanceBypassed(pathname, rest)) {
    const inMaintenance = await getMaintenanceStatus(request.url, currentTenantId);
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
    // Injecter le pathname en request header pour que le layout puisse
    // decider s'il doit rediriger vers /admin/bienvenue (wizard onboarding).
    const requestHeaders = new Headers(requestHeadersWithTenant);
    requestHeaders.set("x-current-path", pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
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
