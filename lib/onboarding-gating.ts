/**
 * Whitelist des chemins accessibles quand l'onboarding wizard n'est pas
 * termine. Extrait de middleware.ts pour etre testable sans charger tout
 * next/next-intl.
 */

export function isPreOnboardingAllowed(pathname: string, rest: string): boolean {
  return (
    rest.startsWith("/connexion") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/onboarding-status") ||
    pathname.startsWith("/api/site-status") ||
    pathname.startsWith("/_next") ||
    pathname === "/api/health" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon" ||
    pathname === "/apple-icon" ||
    pathname === "/favicon.ico"
  );
}
