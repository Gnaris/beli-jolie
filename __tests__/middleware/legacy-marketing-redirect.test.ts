/**
 * Tests pour redirectLegacyMarketingUrl() — redirect 301 des anciennes URL
 * /admin/marketing vers les nouvelles /admin/contact-client.
 *
 * Contexte : rename 2026-10-28 — « Marketing » devient « Contact Client ».
 * Le middleware pose un 301 pour ne pas casser les anciens bookmarks ni les
 * liens contenus dans les mails de notification admin déjà envoyés.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => ({ headers: new Map() }),
}));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["fr", "en"], defaultLocale: "fr" },
}));

import { redirectLegacyMarketingUrl } from "@/middleware";

describe("redirectLegacyMarketingUrl", () => {
  it("redirige /admin/marketing vers /admin/contact-client", () => {
    expect(redirectLegacyMarketingUrl("/admin/marketing")).toBe("/admin/contact-client");
  });

  it("préserve la sous-route sur /admin/marketing/mails", () => {
    expect(redirectLegacyMarketingUrl("/admin/marketing/mails")).toBe(
      "/admin/contact-client/mails",
    );
  });

  it("préserve la sous-route profonde avec id (ex. newsletter)", () => {
    expect(
      redirectLegacyMarketingUrl("/admin/marketing/mails/newsletter/abc123"),
    ).toBe("/admin/contact-client/mails/newsletter/abc123");
  });

  it("préserve /admin/marketing/mails/panier-abandonne", () => {
    expect(redirectLegacyMarketingUrl("/admin/marketing/mails/panier-abandonne")).toBe(
      "/admin/contact-client/mails/panier-abandonne",
    );
  });

  it("ne redirige pas les nouvelles URL /admin/contact-client (idempotence)", () => {
    expect(redirectLegacyMarketingUrl("/admin/contact-client")).toBeNull();
    expect(redirectLegacyMarketingUrl("/admin/contact-client/mails")).toBeNull();
  });

  it("ne redirige pas une URL admin qui commence par /admin/marketing mais n'est pas exacte", () => {
    // /admin/marketing-truc ≠ /admin/marketing
    expect(redirectLegacyMarketingUrl("/admin/marketing-truc")).toBeNull();
  });

  it("ne redirige pas les URL sans rapport (protection anti-faux-positif)", () => {
    expect(redirectLegacyMarketingUrl("/admin/produits")).toBeNull();
    expect(redirectLegacyMarketingUrl("/admin/clients")).toBeNull();
    expect(redirectLegacyMarketingUrl("/api/marketing-webhook")).toBeNull();
  });
});
