/**
 * Tests pour redirectLegacyClaimsUrl() — redirect 301 des anciennes URL
 * /reclamations vers les nouvelles /service-client (client + admin).
 *
 * Contexte : la refonte 2026-09-24 renomme /reclamations en /service-client.
 * Un middleware pose un 301 sur les anciennes URL pour ne pas casser les liens
 * dans les emails déjà envoyés ni les bookmarks des clientes.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => ({ headers: new Map() }),
}));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["fr", "en"], defaultLocale: "fr" },
}));

import { redirectLegacyClaimsUrl } from "@/middleware";

describe("redirectLegacyClaimsUrl", () => {
  it("redirige /admin/reclamations vers /admin/service-client", () => {
    expect(redirectLegacyClaimsUrl("/admin/reclamations")).toBe("/admin/service-client");
  });

  it("préserve l'id sur /admin/reclamations/[id]", () => {
    expect(redirectLegacyClaimsUrl("/admin/reclamations/abc123")).toBe(
      "/admin/service-client/abc123",
    );
  });

  it("redirige /fr/espace-pro/reclamations vers /fr/espace-pro/service-client", () => {
    expect(redirectLegacyClaimsUrl("/fr/espace-pro/reclamations")).toBe(
      "/fr/espace-pro/service-client",
    );
  });

  it("redirige /en/espace-pro/reclamations avec id vers son équivalent", () => {
    expect(redirectLegacyClaimsUrl("/en/espace-pro/reclamations/xyz789")).toBe(
      "/en/espace-pro/service-client/xyz789",
    );
  });

  it("redirige /espace-pro/reclamations sans locale (avant intl)", () => {
    expect(redirectLegacyClaimsUrl("/espace-pro/reclamations")).toBe(
      "/espace-pro/service-client",
    );
  });

  it("redirige /espace-pro/reclamations/nouveau avec preselection commande", () => {
    // Le query string est géré séparément par le middleware, le helper ne s'occupe que du path.
    expect(redirectLegacyClaimsUrl("/fr/espace-pro/reclamations/nouveau")).toBe(
      "/fr/espace-pro/service-client/nouveau",
    );
  });

  it("ne redirige pas les nouvelles URL /service-client (idempotence)", () => {
    expect(redirectLegacyClaimsUrl("/admin/service-client")).toBeNull();
    expect(redirectLegacyClaimsUrl("/fr/espace-pro/service-client/abc")).toBeNull();
  });

  it("ne redirige pas les URL sans rapport (protection anti-faux-positif)", () => {
    expect(redirectLegacyClaimsUrl("/admin/produits")).toBeNull();
    expect(redirectLegacyClaimsUrl("/fr/espace-pro/commandes")).toBeNull();
    expect(redirectLegacyClaimsUrl("/reclamations-produits")).toBeNull();
    expect(redirectLegacyClaimsUrl("/api/reclamations")).toBeNull();
  });

  it("ne redirige pas une URL admin qui commence par /admin/reclamations mais n'est pas exacte", () => {
    // /admin/reclamations-truc ≠ /admin/reclamations
    expect(redirectLegacyClaimsUrl("/admin/reclamations-truc")).toBeNull();
  });
});
