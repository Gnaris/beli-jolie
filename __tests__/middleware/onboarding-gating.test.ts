/**
 * Tests pour la logique de "gating" onboarding du middleware :
 * quels chemins sont accessibles quand la boutique n'est pas encore configuree.
 */
import { describe, it, expect } from "vitest";
import { isPreOnboardingAllowed } from "@/lib/onboarding-gating";

describe("isPreOnboardingAllowed", () => {
  it("autorise la page de connexion (avec locale)", () => {
    expect(isPreOnboardingAllowed("/fr/connexion", "/connexion")).toBe(true);
    expect(isPreOnboardingAllowed("/en/connexion", "/connexion")).toBe(true);
  });

  it("autorise l'API auth NextAuth", () => {
    expect(isPreOnboardingAllowed("/api/auth/signin", "/api/auth/signin")).toBe(true);
    expect(isPreOnboardingAllowed("/api/auth/callback/credentials", "/api/auth/callback/credentials")).toBe(true);
  });

  it("autorise l'API onboarding-status (pour le middleware)", () => {
    expect(isPreOnboardingAllowed("/api/onboarding-status", "/api/onboarding-status")).toBe(true);
  });

  it("autorise les assets Next.js", () => {
    expect(isPreOnboardingAllowed("/_next/static/foo.css", "/_next/static/foo.css")).toBe(true);
    expect(isPreOnboardingAllowed("/_next/image", "/_next/image")).toBe(true);
  });

  it("autorise favicon, manifest et icônes PWA", () => {
    expect(isPreOnboardingAllowed("/favicon.ico", "/favicon.ico")).toBe(true);
    expect(isPreOnboardingAllowed("/manifest.webmanifest", "/manifest.webmanifest")).toBe(true);
    expect(isPreOnboardingAllowed("/icon", "/icon")).toBe(true);
    expect(isPreOnboardingAllowed("/apple-icon", "/apple-icon")).toBe(true);
  });

  it("N'AUTORISE PAS la homepage cliente", () => {
    expect(isPreOnboardingAllowed("/fr", "/")).toBe(false);
    expect(isPreOnboardingAllowed("/", "/")).toBe(false);
  });

  it("N'AUTORISE PAS le catalogue, panier, favoris, produits, commandes", () => {
    expect(isPreOnboardingAllowed("/fr/produits", "/produits")).toBe(false);
    expect(isPreOnboardingAllowed("/fr/panier", "/panier")).toBe(false);
    expect(isPreOnboardingAllowed("/fr/favoris", "/favoris")).toBe(false);
    expect(isPreOnboardingAllowed("/fr/commandes", "/commandes")).toBe(false);
    expect(isPreOnboardingAllowed("/fr/collections", "/collections")).toBe(false);
  });

  it("N'AUTORISE PAS la page d'inscription (on ne veut pas d'inscription client tant que la boutique n'est pas prête)", () => {
    expect(isPreOnboardingAllowed("/fr/inscription", "/inscription")).toBe(false);
  });

  it("N'AUTORISE PAS l'API produits ou panier", () => {
    expect(isPreOnboardingAllowed("/api/products", "/api/products")).toBe(false);
    expect(isPreOnboardingAllowed("/api/cart/count", "/api/cart/count")).toBe(false);
  });

  it("N'AUTORISE PAS /admin (l'admin ira sur /admin/bienvenue via un traitement séparé)", () => {
    // /admin n'est pas listé dans isPreOnboardingAllowed — c'est le middleware
    // qui redirige les admins vers /admin/bienvenue explicitement.
    expect(isPreOnboardingAllowed("/admin", "/admin")).toBe(false);
    expect(isPreOnboardingAllowed("/admin/produits", "/admin/produits")).toBe(false);
  });
});
