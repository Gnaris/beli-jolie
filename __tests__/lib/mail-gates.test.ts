/**
 * Tests de lib/mail-gates.ts — fonction pure computeMailGates.
 *
 * Une suite par scenario, plus la couche transverse (opt-out newsletter,
 * status non-APPROVED, anti-spam 3 jours).
 *
 * Règles validées avec la cliente le 2026-08-11.
 */
import { describe, it, expect } from "vitest";
import {
  computeMailGates,
  hasBlockers,
  getBlockers,
  getWarnings,
  GATE_THRESHOLDS,
  type MailGateInput,
} from "@/lib/mail-gates";

const NOW = new Date("2026-08-11T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function baseInput(overrides: Partial<MailGateInput> = {}): MailGateInput {
  return {
    scenario: "NEWSLETTER",
    now: NOW,
    acceptsNewsletter: true,
    status: "APPROVED",
    cart: { itemCount: 0, updatedAt: null, allOutOfStock: false },
    activity: { lastActivityAt: daysAgo(10), daysSinceLastActivity: 10 },
    history: { orderCount: 3 },
    favorites: { inStockCount: 0, recentlyRestockedCount: 0 },
    selectedProducts: { count: 0, allInStock: true },
    lastSentByScenario: {},
    lastMarketingSentAt: null,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
describe("computeMailGates — règles transverses", () => {
  it("bloque si acceptsNewsletter = false (tous scenarios)", () => {
    for (const scenario of ["ABANDONED_CART", "INACTIVE_CLIENT", "NEWSLETTER", "RESTOCK"] as const) {
      const gates = computeMailGates(baseInput({ scenario, acceptsNewsletter: false }));
      const codes = gates.map((g) => g.code);
      expect(codes).toContain("NEWSLETTER_OPT_OUT");
      expect(hasBlockers(gates)).toBe(true);
    }
  });

  it("bloque si status = PENDING", () => {
    const gates = computeMailGates(baseInput({ status: "PENDING" }));
    expect(getBlockers(gates).some((g) => g.code === "ACCOUNT_NOT_APPROVED")).toBe(true);
  });

  it("bloque si status = REJECTED", () => {
    const gates = computeMailGates(baseInput({ status: "REJECTED" }));
    expect(getBlockers(gates).some((g) => g.code === "ACCOUNT_NOT_APPROVED")).toBe(true);
  });

  it("warning si dernière communication marketing < 3 jours", () => {
    const gates = computeMailGates(baseInput({ lastMarketingSentAt: daysAgo(1) }));
    const warn = getWarnings(gates).find((g) => g.code === "MARKETING_COOLDOWN");
    expect(warn).toBeDefined();
    expect(warn?.level).toBe("warning");
  });

  it("pas de warning si dernière communication >= 3 jours", () => {
    const gates = computeMailGates(baseInput({ lastMarketingSentAt: daysAgo(3.5) }));
    expect(getWarnings(gates).some((g) => g.code === "MARKETING_COOLDOWN")).toBe(false);
  });

  it("pas de warning si jamais de communication précédente", () => {
    const gates = computeMailGates(baseInput({ lastMarketingSentAt: null }));
    expect(getWarnings(gates).some((g) => g.code === "MARKETING_COOLDOWN")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("computeMailGates — NEWSLETTER", () => {
  it("passe avec juste opt-in + APPROVED (aucune autre condition)", () => {
    const gates = computeMailGates(
      baseInput({
        scenario: "NEWSLETTER",
        activity: { lastActivityAt: null, daysSinceLastActivity: null }, // jamais connecté OK
        history: { orderCount: 0 }, // pas de commande OK
      }),
    );
    expect(hasBlockers(gates)).toBe(false);
  });

  it("client jamais connecté = envoi autorisé sans warning", () => {
    const gates = computeMailGates(
      baseInput({
        scenario: "NEWSLETTER",
        activity: { lastActivityAt: null, daysSinceLastActivity: null },
      }),
    );
    expect(hasBlockers(gates)).toBe(false);
    expect(getWarnings(gates)).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("computeMailGates — ABANDONED_CART", () => {
  const cartBase = baseInput({
    scenario: "ABANDONED_CART",
    cart: { itemCount: 2, updatedAt: daysAgo(2), allOutOfStock: false },
  });

  it("passe avec panier de 2 items abandonné depuis 2j, aucun envoi précédent", () => {
    expect(hasBlockers(computeMailGates(cartBase))).toBe(false);
  });

  it("bloque si panier vide", () => {
    const gates = computeMailGates({ ...cartBase, cart: { itemCount: 0, updatedAt: null, allOutOfStock: false } });
    expect(getBlockers(gates).some((g) => g.code === "CART_EMPTY")).toBe(true);
  });

  it("bloque si panier modifié il y a < 24h", () => {
    const gates = computeMailGates({
      ...cartBase,
      cart: { itemCount: 2, updatedAt: hoursAgo(6), allOutOfStock: false },
    });
    expect(getBlockers(gates).some((g) => g.code === "CART_TOO_RECENT")).toBe(true);
  });

  it("autorise si panier modifié il y a exactement 24h", () => {
    const gates = computeMailGates({
      ...cartBase,
      cart: { itemCount: 2, updatedAt: hoursAgo(24), allOutOfStock: false },
    });
    expect(getBlockers(gates).some((g) => g.code === "CART_TOO_RECENT")).toBe(false);
  });

  it("bloque si panier > 30 jours", () => {
    const gates = computeMailGates({
      ...cartBase,
      cart: { itemCount: 2, updatedAt: daysAgo(35), allOutOfStock: false },
    });
    expect(getBlockers(gates).some((g) => g.code === "CART_TOO_OLD")).toBe(true);
  });

  it("bloque si dernier envoi < 7 jours", () => {
    const gates = computeMailGates({
      ...cartBase,
      lastSentByScenario: { ABANDONED_CART: daysAgo(4) },
    });
    expect(getBlockers(gates).some((g) => g.code === "ABANDONED_CART_COOLDOWN")).toBe(true);
  });

  it("autorise si dernier envoi >= 7 jours", () => {
    const gates = computeMailGates({
      ...cartBase,
      lastSentByScenario: { ABANDONED_CART: daysAgo(8) },
    });
    expect(getBlockers(gates).some((g) => g.code === "ABANDONED_CART_COOLDOWN")).toBe(false);
  });

  it("warning si tous les items en rupture", () => {
    const gates = computeMailGates({
      ...cartBase,
      cart: { itemCount: 2, updatedAt: daysAgo(2), allOutOfStock: true },
    });
    expect(getWarnings(gates).some((g) => g.code === "CART_ALL_OUT_OF_STOCK")).toBe(true);
    expect(hasBlockers(gates)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("computeMailGates — INACTIVE_CLIENT", () => {
  const inactiveBase = baseInput({
    scenario: "INACTIVE_CLIENT",
    activity: { lastActivityAt: daysAgo(20), daysSinceLastActivity: 20 },
    history: { orderCount: 5 },
  });

  it("passe avec 20j d'inactivité + 5 commandes précédentes", () => {
    expect(hasBlockers(computeMailGates(inactiveBase))).toBe(false);
  });

  it("bloque si inactivité < 15 jours", () => {
    const gates = computeMailGates({
      ...inactiveBase,
      activity: { lastActivityAt: daysAgo(10), daysSinceLastActivity: 10 },
    });
    expect(getBlockers(gates).some((g) => g.code === "NOT_INACTIVE_ENOUGH")).toBe(true);
  });

  it("bloque si client jamais connecté (daysSinceLastActivity = null)", () => {
    const gates = computeMailGates({
      ...inactiveBase,
      activity: { lastActivityAt: null, daysSinceLastActivity: null },
    });
    expect(getBlockers(gates).some((g) => g.code === "NOT_INACTIVE_ENOUGH")).toBe(true);
  });

  it("bloque si aucune commande précédente (prospect, pas client)", () => {
    const gates = computeMailGates({ ...inactiveBase, history: { orderCount: 0 } });
    expect(getBlockers(gates).some((g) => g.code === "NO_PRIOR_ORDER")).toBe(true);
  });

  it("bloque si dernière relance inactivité < 30 jours", () => {
    const gates = computeMailGates({
      ...inactiveBase,
      lastSentByScenario: { INACTIVE_CLIENT: daysAgo(15) },
    });
    expect(getBlockers(gates).some((g) => g.code === "INACTIVE_COOLDOWN")).toBe(true);
  });

  it("warning si panier non-vide (préférer 'panier abandonné')", () => {
    const gates = computeMailGates({
      ...inactiveBase,
      cart: { itemCount: 3, updatedAt: daysAgo(65), allOutOfStock: false },
    });
    expect(getWarnings(gates).some((g) => g.code === "HAS_ACTIVE_CART")).toBe(true);
    expect(hasBlockers(gates)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("computeMailGates — RESTOCK (sur sélection de produits)", () => {
  const restockBase = baseInput({
    scenario: "RESTOCK",
    selectedProducts: { count: 2, allInStock: true },
  });

  it("passe avec 2 produits sélectionnés tous en stock", () => {
    expect(hasBlockers(computeMailGates(restockBase))).toBe(false);
  });

  it("bloque si 0 produit sélectionné", () => {
    const gates = computeMailGates({
      ...restockBase,
      selectedProducts: { count: 0, allInStock: true },
    });
    expect(getBlockers(gates).some((g) => g.code === "NO_PRODUCT_SELECTED")).toBe(true);
  });

  it("bloque si un produit sélectionné est en rupture", () => {
    const gates = computeMailGates({
      ...restockBase,
      selectedProducts: { count: 2, allInStock: false },
    });
    expect(getBlockers(gates).some((g) => g.code === "SELECTED_PRODUCTS_OUT_OF_STOCK")).toBe(true);
  });

  it("bloque si dernier RESTOCK < 14 jours", () => {
    const gates = computeMailGates({
      ...restockBase,
      lastSentByScenario: { RESTOCK: daysAgo(10) },
    });
    expect(getBlockers(gates).some((g) => g.code === "RESTOCK_COOLDOWN")).toBe(true);
  });

  it("autorise si dernier RESTOCK >= 14 jours", () => {
    const gates = computeMailGates({
      ...restockBase,
      lastSentByScenario: { RESTOCK: daysAgo(20) },
    });
    expect(getBlockers(gates).some((g) => g.code === "RESTOCK_COOLDOWN")).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
describe("computeMailGates — combinaisons", () => {
  it("cumule blockers de plusieurs sources", () => {
    const gates = computeMailGates(
      baseInput({
        scenario: "ABANDONED_CART",
        acceptsNewsletter: false,
        status: "PENDING",
        cart: { itemCount: 0, updatedAt: null, allOutOfStock: false },
      }),
    );
    const codes = getBlockers(gates).map((g) => g.code);
    expect(codes).toContain("NEWSLETTER_OPT_OUT");
    expect(codes).toContain("ACCOUNT_NOT_APPROVED");
    expect(codes).toContain("CART_EMPTY");
  });

  it("respecte les seuils exactement (test des bornes)", () => {
    // Exactement 24h : PAS bloqué
    const at24h = computeMailGates(
      baseInput({
        scenario: "ABANDONED_CART",
        cart: { itemCount: 1, updatedAt: hoursAgo(GATE_THRESHOLDS.ABANDONED_CART_MIN_HOURS), allOutOfStock: false },
      }),
    );
    expect(getBlockers(at24h).some((g) => g.code === "CART_TOO_RECENT")).toBe(false);

    // 23h59 : bloqué
    const at23h = computeMailGates(
      baseInput({
        scenario: "ABANDONED_CART",
        cart: { itemCount: 1, updatedAt: hoursAgo(23), allOutOfStock: false },
      }),
    );
    expect(getBlockers(at23h).some((g) => g.code === "CART_TOO_RECENT")).toBe(true);
  });
});
