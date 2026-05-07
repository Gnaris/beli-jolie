/**
 * Tests for lib/price-visibility.ts
 *
 * Règle métier : seuls les ADMIN ou les CLIENT au statut APPROVED voient les prix.
 * Les visiteurs anonymes et les comptes PENDING/REJECTED ne les voient pas.
 */
import { describe, it, expect } from "vitest";
import { canSeePrices, canSeePricesFromUser } from "@/lib/price-visibility";
import type { Session } from "next-auth";

function buildSession(user: Partial<Session["user"]> | null): Session | null {
  if (!user) return null;
  return {
    user: {
      id: user.id ?? "user-id",
      email: user.email ?? "user@test.tld",
      name: user.name ?? "Test User",
      role: user.role ?? "CLIENT",
      status: user.status ?? "PENDING",
      company: user.company ?? "Test SARL",
    },
    expires: "2099-01-01T00:00:00.000Z",
  } as Session;
}

describe("canSeePrices", () => {
  it("renvoie false pour un visiteur anonyme (session null)", () => {
    expect(canSeePrices(null)).toBe(false);
    expect(canSeePrices(undefined)).toBe(false);
  });

  it("renvoie true pour un ADMIN, peu importe son statut", () => {
    expect(canSeePrices(buildSession({ role: "ADMIN", status: "APPROVED" }))).toBe(true);
    expect(canSeePrices(buildSession({ role: "ADMIN", status: "PENDING" }))).toBe(true);
  });

  it("renvoie true pour un CLIENT APPROVED", () => {
    expect(canSeePrices(buildSession({ role: "CLIENT", status: "APPROVED" }))).toBe(true);
  });

  it("renvoie false pour un CLIENT PENDING", () => {
    expect(canSeePrices(buildSession({ role: "CLIENT", status: "PENDING" }))).toBe(false);
  });

  it("renvoie false pour un CLIENT REJECTED", () => {
    expect(canSeePrices(buildSession({ role: "CLIENT", status: "REJECTED" }))).toBe(false);
  });
});

describe("canSeePricesFromUser", () => {
  it("renvoie false pour user null/undefined", () => {
    expect(canSeePricesFromUser(null)).toBe(false);
    expect(canSeePricesFromUser(undefined)).toBe(false);
  });

  it("renvoie true pour ADMIN", () => {
    expect(canSeePricesFromUser({ role: "ADMIN", status: "APPROVED" })).toBe(true);
    expect(canSeePricesFromUser({ role: "ADMIN", status: "PENDING" })).toBe(true);
  });

  it("renvoie true pour CLIENT APPROVED", () => {
    expect(canSeePricesFromUser({ role: "CLIENT", status: "APPROVED" })).toBe(true);
  });

  it("renvoie false pour CLIENT non APPROVED", () => {
    expect(canSeePricesFromUser({ role: "CLIENT", status: "PENDING" })).toBe(false);
    expect(canSeePricesFromUser({ role: "CLIENT", status: "REJECTED" })).toBe(false);
  });
});
