/**
 * Whitelist des chemins accessibles quand l'onboarding wizard n'est pas
 * termine. Extrait de middleware.ts pour etre testable sans charger tout
 * next/next-intl.
 */

export function isPreOnboardingAllowed(pathname: string, rest: string): boolean {
  return (
    rest.startsWith("/connexion") ||
    pathname.startsWith("/api/auth") ||
    // Les routes admin (page + API) doivent rester accessibles pendant
    // l'onboarding : le wizard lui-même s'appuie sur /api/admin/banner/image,
    // /api/admin/favicon/image, les server actions dans /admin/bienvenue, etc.
    // La sécurité est assurée en aval par requireAdmin() dans chaque route.
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/api/onboarding-status") ||
    pathname.startsWith("/api/site-status") ||
    pathname.startsWith("/_next") ||
    pathname === "/api/health" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/favicon.ico" ||
    // Dev-only : endpoints de test cross-tenant, gated NODE_ENV=development
    pathname.startsWith("/api/dev/")
  );
}
