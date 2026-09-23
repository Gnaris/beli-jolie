import { describe, it, expect } from "vitest";
import { clampCreditToApply } from "@/lib/credit-clamp";

describe("clampCreditToApply", () => {
  it("applique le montant demandé quand il tient dans le solde ET le TTC", () => {
    const r = clampCreditToApply({
      availableCredit: 50,
      totalTTC: 100,
      requested: 30,
    });
    expect(r.creditApplied).toBe(30);
    expect(r.amountDue).toBe(70);
    expect(r.amountDueCents).toBe(7000);
  });

  it("clamp au solde quand la cliente demande plus que ce qu'elle a", () => {
    const r = clampCreditToApply({
      availableCredit: 20,
      totalTTC: 100,
      requested: 999,
    });
    expect(r.creditApplied).toBe(20);
    expect(r.amountDue).toBe(80);
  });

  it("clamp au TTC quand le solde dépasse le total commande", () => {
    const r = clampCreditToApply({
      availableCredit: 500,
      totalTTC: 42.5,
      requested: 500,
    });
    expect(r.creditApplied).toBe(42.5);
    expect(r.amountDue).toBe(0);
    expect(r.amountDueCents).toBe(0);
  });

  it("crédit exact = TTC → rien à payer, cas 100 % couvert", () => {
    const r = clampCreditToApply({
      availableCredit: 100,
      totalTTC: 100,
      requested: 100,
    });
    expect(r.creditApplied).toBe(100);
    expect(r.amountDueCents).toBe(0);
  });

  it("aucun crédit demandé → 0 appliqué, TTC intact", () => {
    const r = clampCreditToApply({
      availableCredit: 50,
      totalTTC: 100,
      requested: 0,
    });
    expect(r.creditApplied).toBe(0);
    expect(r.amountDue).toBe(100);
    expect(r.amountDueCents).toBe(10000);
  });

  it("montant demandé négatif → clamp à 0 (jamais crédité de crédit)", () => {
    const r = clampCreditToApply({
      availableCredit: 50,
      totalTTC: 100,
      requested: -25,
    });
    expect(r.creditApplied).toBe(0);
    expect(r.amountDue).toBe(100);
  });

  it("solde négatif (état corrompu) → 0 appliqué", () => {
    const r = clampCreditToApply({
      availableCredit: -10,
      totalTTC: 100,
      requested: 5,
    });
    expect(r.creditApplied).toBe(0);
    expect(r.amountDue).toBe(100);
  });

  it("arrondi centime : 33.333 → 33.33", () => {
    const r = clampCreditToApply({
      availableCredit: 33.333,
      totalTTC: 100,
      requested: 33.333,
    });
    expect(r.creditApplied).toBe(33.33);
    expect(r.amountDueCents).toBe(6667);
  });

  it("solde à 1 centime sur un TTC de 50 € → reste 49,99 € à payer", () => {
    const r = clampCreditToApply({
      availableCredit: 0.01,
      totalTTC: 50,
      requested: 0.01,
    });
    expect(r.creditApplied).toBe(0.01);
    expect(r.amountDueCents).toBe(4999);
  });
});
