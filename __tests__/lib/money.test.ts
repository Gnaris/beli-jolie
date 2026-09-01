import { describe, it, expect } from "vitest";
import { roundCent } from "@/lib/money";

describe("roundCent — arrondi au centime le plus proche (règle Sage)", () => {
  it("arrondit au plus proche vers le haut à partir de 0,5 centième", () => {
    expect(roundCent(234.025)).toBe(234.03);
    expect(roundCent(234.029)).toBe(234.03);
    expect(roundCent(234.024)).toBe(234.02);
  });

  it("laisse intact un montant déjà au centime", () => {
    expect(roundCent(0)).toBe(0);
    expect(roundCent(100)).toBe(100);
    expect(roundCent(234.02)).toBe(234.02);
  });

  it("absorbe l'imprécision IEEE-754 sur les multiplications", () => {
    // 225.20 * 0.9 = 202.679999999… en JavaScript. Sage donne 202.68.
    expect(roundCent(225.2 * 0.9)).toBe(202.68);
    // 190.98 * 0.20 = 38.196 en flottant. Sage donne 38.20.
    expect(roundCent(190.98 * 0.2)).toBe(38.2);
  });

  it("reproduit exactement la facture Sage FA10005485", () => {
    const totalHT = 212.2;
    const remise = roundCent(totalHT * 0.1);
    const netHT = roundCent(totalHT - remise);
    const tva = roundCent(netHT * 0.2);
    const ttc = roundCent(netHT + tva);

    expect(remise).toBe(21.22);
    expect(netHT).toBe(190.98);
    expect(tva).toBe(38.2);
    expect(ttc).toBe(229.18);
  });

  it("retourne 0 pour NaN / Infinity", () => {
    expect(roundCent(Number.NaN)).toBe(0);
    expect(roundCent(Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundCent(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
