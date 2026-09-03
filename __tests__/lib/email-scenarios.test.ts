/**
 * Tests pour lib/email-scenarios.ts — catalogue centralisé des types
 * d'emails tracés dans EmailSend.
 */
import { describe, it, expect } from "vitest";
import {
  EMAIL_SCENARIOS,
  EMAIL_SCENARIOS_LIST,
  getScenarioLabel,
  getScenarioCategory,
} from "@/lib/email-scenarios";

describe("email-scenarios", () => {
  it("expose tous les types clés au moins une fois", () => {
    const keys = Object.values(EMAIL_SCENARIOS).map((s) => s.key);
    expect(keys).toContain("LOGIN_OTP");
    expect(keys).toContain("PASSWORD_RESET");
    expect(keys).toContain("ACCOUNT_APPROVED");
    expect(keys).toContain("ACCOUNT_REJECTED");
    expect(keys).toContain("ACCOUNT_REVOKED");
    expect(keys).toContain("ORDER_CREATED");
    expect(keys).toContain("ORDER_VALIDATED");
    expect(keys).toContain("ORDER_SHIPPED");
    expect(keys).toContain("ORDER_CANCELLED");
    expect(keys).toContain("ORDER_MODIFIED");
    expect(keys).toContain("SUPPORT_REPLY");
    expect(keys).toContain("CLAIM_REPLY");
    expect(keys).toContain("NEWSLETTER");
    expect(keys).toContain("ABANDONED_CART");
    expect(keys).toContain("RESTOCK");
    expect(keys).toContain("INACTIVE_CLIENT");
  });

  it("getScenarioLabel renvoie le libellé français attendu", () => {
    expect(getScenarioLabel("LOGIN_OTP")).toBe("Connexion par code");
    expect(getScenarioLabel("ORDER_SHIPPED")).toBe("Commande expédiée");
    expect(getScenarioLabel("NEWSLETTER")).toBe("Newsletter");
  });

  it("getScenarioLabel tolère une valeur inconnue (renvoie la clé brute)", () => {
    expect(getScenarioLabel("KEY_QUI_NEXISTE_PAS")).toBe("KEY_QUI_NEXISTE_PAS");
  });

  it("getScenarioCategory classe correctement les scénarios", () => {
    expect(getScenarioCategory("LOGIN_OTP")).toBe("connexion");
    expect(getScenarioCategory("PASSWORD_RESET")).toBe("connexion");
    expect(getScenarioCategory("ACCOUNT_APPROVED")).toBe("compte");
    expect(getScenarioCategory("ORDER_CREATED")).toBe("commande");
    expect(getScenarioCategory("SUPPORT_REPLY")).toBe("support");
    expect(getScenarioCategory("NEWSLETTER")).toBe("marketing");
  });

  it("EMAIL_SCENARIOS_LIST expose la liste triée pour les filtres UI", () => {
    expect(EMAIL_SCENARIOS_LIST).toHaveLength(
      Object.keys(EMAIL_SCENARIOS).length,
    );
    for (const item of EMAIL_SCENARIOS_LIST) {
      expect(item.key).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.category).toBeTruthy();
    }
  });
});
