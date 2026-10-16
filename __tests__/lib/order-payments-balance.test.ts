import { describe, it, expect } from "vitest";
import { computeOrderBalanceAmounts } from "@/lib/order-payments";

describe("computeOrderBalanceAmounts", () => {
  it("équilibre quand paiements PAID = nouveau total", () => {
    expect(computeOrderBalanceAmounts({ newTotalTTC: 100, paidTotalTTC: 100 })).toEqual({
      remainingToPay: 0,
      creditToRefund: 0,
    });
  });

  it("expose remainingToPay quand plusieurs paiements PAID ne couvrent pas le nouveau total", () => {
    // Scénario : commande initiale 80 € payée, puis modif qui monte à 120 € →
    // reste 40 € à régler.
    expect(computeOrderBalanceAmounts({ newTotalTTC: 120, paidTotalTTC: 80 })).toEqual({
      remainingToPay: 40,
      creditToRefund: 0,
    });
  });

  it("expose creditToRefund quand la cliente a trop payé (annulation après compléments)", () => {
    // Scénario : 5 encaissements successifs totalisent 150 €, puis annulation
    // partielle fait retomber le total à 60 € → avoir à rembourser 90 €.
    expect(computeOrderBalanceAmounts({ newTotalTTC: 60, paidTotalTTC: 150 })).toEqual({
      remainingToPay: 0,
      creditToRefund: 90,
    });
  });

  it("arrondit les artefacts IEEE-754 au centime", () => {
    const b = computeOrderBalanceAmounts({
      newTotalTTC: 4.2 * 3, // = 12.600000000000001
      paidTotalTTC: 12.6,
    });
    expect(b.remainingToPay).toBe(0);
    expect(b.creditToRefund).toBe(0);
  });
});
