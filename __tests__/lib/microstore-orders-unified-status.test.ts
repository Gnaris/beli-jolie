/**
 * Vérifie que les commandes Microstore sont affichées comme « Expédiée »
 * dans la vue marketplaces unifiée dès qu'elles sont importées, avec un
 * état stock « À déduire » si au moins un article est rattaché au catalogue
 * BJ. Reflète la règle métier : une commande Microstore importable = validée
 * ET expédiée côté POS.
 *
 * Le helper `normalizeMicrostoreToUnified` n'est pas exporté directement
 * (il est privé à `app/actions/admin/marketplace-orders.ts`), donc ce test
 * documente le contrat via un mini-reproducer aligné sur l'implémentation.
 */

import { describe, expect, it } from "vitest";

type MicrostoreDbStatus = "NEW" | "SHIPPED" | "CANCELLED";
type UnifiedStatus = "NEW" | "VALIDATED" | "SHIPPED" | "CANCELLED";

function normalizeMicrostoreToUnified(s: MicrostoreDbStatus): UnifiedStatus {
  if (s === "CANCELLED") return "CANCELLED";
  return "SHIPPED";
}

describe("normalizeMicrostoreToUnified", () => {
  it("mappe NEW (base) vers SHIPPED (déjà validée + expédiée côté POS)", () => {
    expect(normalizeMicrostoreToUnified("NEW")).toBe("SHIPPED");
  });

  it("garde SHIPPED (base) → SHIPPED (unifié)", () => {
    expect(normalizeMicrostoreToUnified("SHIPPED")).toBe("SHIPPED");
  });

  it("garde CANCELLED (base) → CANCELLED (unifié)", () => {
    expect(normalizeMicrostoreToUnified("CANCELLED")).toBe("CANCELLED");
  });

  it("ne renvoie jamais NEW ni VALIDATED (Microstore n'a pas ces buckets)", () => {
    for (const s of ["NEW", "SHIPPED", "CANCELLED"] as MicrostoreDbStatus[]) {
      const u = normalizeMicrostoreToUnified(s);
      expect(u).not.toBe("NEW");
      expect(u).not.toBe("VALIDATED");
    }
  });
});

/**
 * Contrat de `computeMicrostoreStockDeductionMap` : reflète l'implémentation
 * de `app/actions/admin/marketplace-orders.ts`.
 *
 *  - CANCELLED → NOT_APPLICABLE (peu importe l'état des items)
 *  - dedMap.count > 0 → DONE
 *  - elMap.count === 0 → NOTHING_TO_DEDUCT (aucun item rattaché au catalogue)
 *  - sinon → PENDING (« À déduire »)
 */

type StockState = "NOT_APPLICABLE" | "NOTHING_TO_DEDUCT" | "PENDING" | "DONE";

function computeStateForOrder(
  status: MicrostoreDbStatus,
  eligibleCount: number,
  deductedCount: number,
): StockState {
  if (status === "CANCELLED") return "NOT_APPLICABLE";
  if (deductedCount > 0) return "DONE";
  if (eligibleCount === 0) return "NOTHING_TO_DEDUCT";
  return "PENDING";
}

describe("computeMicrostoreStockDeductionMap (contract)", () => {
  it("une commande NEW avec des items liés au catalogue est « À déduire »", () => {
    expect(computeStateForOrder("NEW", 2, 0)).toBe("PENDING");
  });

  it("une commande SHIPPED avec des items liés est « À déduire » aussi", () => {
    expect(computeStateForOrder("SHIPPED", 3, 0)).toBe("PENDING");
  });

  it("une commande où toutes les lignes ont déjà été déduites passe à DONE", () => {
    expect(computeStateForOrder("NEW", 2, 2)).toBe("DONE");
    expect(computeStateForOrder("SHIPPED", 5, 1)).toBe("DONE");
  });

  it("une commande sans article rattaché au catalogue = « Rien à déduire »", () => {
    expect(computeStateForOrder("NEW", 0, 0)).toBe("NOTHING_TO_DEDUCT");
  });

  it("une commande CANCELLED n'est jamais concernée par la déduction", () => {
    expect(computeStateForOrder("CANCELLED", 5, 0)).toBe("NOT_APPLICABLE");
    expect(computeStateForOrder("CANCELLED", 5, 2)).toBe("NOT_APPLICABLE");
  });
});
