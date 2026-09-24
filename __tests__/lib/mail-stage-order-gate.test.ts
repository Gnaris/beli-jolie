import { describe, it, expect } from "vitest";
import { shouldSkipStageForOrderCount } from "@/lib/mail-stage-order-gate";

describe("mail-stage-order-gate — shouldSkipStageForOrderCount", () => {
  it("n'ignore jamais un stade sans plafond (null / undefined)", () => {
    expect(shouldSkipStageForOrderCount(null, 0)).toBe(false);
    expect(shouldSkipStageForOrderCount(null, 100)).toBe(false);
    expect(shouldSkipStageForOrderCount(undefined, 5)).toBe(false);
  });

  it("saute le stade quand le nombre de commandes atteint ou dépasse le plafond", () => {
    // Plafond 1 = « n'envoyer qu'aux clients qui n'ont jamais commandé »
    expect(shouldSkipStageForOrderCount(1, 1)).toBe(true);
    expect(shouldSkipStageForOrderCount(1, 2)).toBe(true);

    // Plafond 3 = « n'envoyer qu'aux clients avec 0, 1 ou 2 commandes »
    expect(shouldSkipStageForOrderCount(3, 3)).toBe(true);
    expect(shouldSkipStageForOrderCount(3, 4)).toBe(true);
  });

  it("envoie le stade quand le nombre de commandes est strictement en dessous", () => {
    expect(shouldSkipStageForOrderCount(1, 0)).toBe(false);
    expect(shouldSkipStageForOrderCount(3, 0)).toBe(false);
    expect(shouldSkipStageForOrderCount(3, 1)).toBe(false);
    expect(shouldSkipStageForOrderCount(3, 2)).toBe(false);
  });

  it("scénario cliente : Stade 1 max 1 commande, Stade 2 max 5", () => {
    // Client qui n'a jamais commandé → reçoit Stade 1 ET Stade 2
    expect(shouldSkipStageForOrderCount(1, 0)).toBe(false);
    expect(shouldSkipStageForOrderCount(5, 0)).toBe(false);

    // Client à 2 commandes → saute Stade 1, reçoit Stade 2
    expect(shouldSkipStageForOrderCount(1, 2)).toBe(true);
    expect(shouldSkipStageForOrderCount(5, 2)).toBe(false);

    // Client à 6 commandes → saute les 2 stades (gros client, silence total)
    expect(shouldSkipStageForOrderCount(1, 6)).toBe(true);
    expect(shouldSkipStageForOrderCount(5, 6)).toBe(true);
  });
});
