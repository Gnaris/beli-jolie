/**
 * Verrou allowlist : les 5 méthodes optionnelles doivent rester exposées (ordre
 * compris). Un retrait silencieux casserait le checkout côté UI (toggle admin
 * invisible) et côté checkout (méthode absente de payment_method_types).
 */
import { describe, it, expect } from "vitest";
import { OPTIONAL_STRIPE_METHODS } from "@/lib/stripe-payment-methods-enabled";

describe("OPTIONAL_STRIPE_METHODS", () => {
  it("contient les 5 méthodes attendues dans l'ordre figé", () => {
    expect(OPTIONAL_STRIPE_METHODS).toEqual([
      "paypal",
      "revolut_pay",
      "billie",
      "bancontact",
      "ideal",
    ]);
  });

  it("expose revolut_pay (ajouté 2026-10-28)", () => {
    expect(OPTIONAL_STRIPE_METHODS).toContain("revolut_pay");
  });
});
