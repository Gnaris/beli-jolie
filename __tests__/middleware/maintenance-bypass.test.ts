/**
 * Tests pour isMaintenanceBypassed() — exemption auto-maintenance.
 *
 * Régression : un callback `POST /api/webhooks/ankorstore` reçu pendant une
 * auto-maintenance se faisait rediriger 307 vers /maintenance et l'op
 * Ankorstore restait figée en PENDING. Les webhooks doivent toujours passer.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next-intl/middleware", () => ({
  default: () => () => ({ headers: new Map() }),
}));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("@/i18n/routing", () => ({
  routing: { locales: ["fr", "en"], defaultLocale: "fr" },
}));

import { isMaintenanceBypassed } from "@/middleware";

describe("isMaintenanceBypassed", () => {
  it("exempte le webhook Ankorstore", () => {
    expect(
      isMaintenanceBypassed("/api/webhooks/ankorstore", "/api/webhooks/ankorstore"),
    ).toBe(true);
  });

  it("exempte tout sous-chemin /api/webhooks/* (Stripe, autres)", () => {
    expect(isMaintenanceBypassed("/api/webhooks/stripe", "/api/webhooks/stripe")).toBe(
      true,
    );
    expect(
      isMaintenanceBypassed("/api/webhooks/pfs/status", "/api/webhooks/pfs/status"),
    ).toBe(true);
  });

  it("exempte /admin, /api/auth, /api/site-status, /maintenance", () => {
    expect(isMaintenanceBypassed("/admin/produits", "/admin/produits")).toBe(true);
    expect(isMaintenanceBypassed("/api/auth/session", "/api/auth/session")).toBe(true);
    expect(isMaintenanceBypassed("/api/site-status", "/api/site-status")).toBe(true);
    expect(isMaintenanceBypassed("/maintenance", "/maintenance")).toBe(true);
  });

  it("exempte les pages légales (préfixe locale possible)", () => {
    expect(isMaintenanceBypassed("/fr/cgv", "/cgv")).toBe(true);
    expect(isMaintenanceBypassed("/en/mentions-legales", "/mentions-legales")).toBe(
      true,
    );
  });

  it("NE PAS exempter une page publique standard", () => {
    expect(isMaintenanceBypassed("/fr/produits/abc", "/produits/abc")).toBe(false);
    expect(isMaintenanceBypassed("/fr", "/")).toBe(false);
    expect(isMaintenanceBypassed("/api/admin/products", "/api/admin/products")).toBe(
      false,
    );
  });
});
