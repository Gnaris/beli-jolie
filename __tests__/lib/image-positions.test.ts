import { describe, it, expect } from "vitest";
import { swapOrDropImageOrder } from "@/lib/image-positions";

describe("swapOrDropImageOrder", () => {
  it("échange deux positions occupées", () => {
    expect(swapOrDropImageOrder([0, 1, 2], 0, 2)).toEqual([2, 1, 0]);
  });

  it("déplace vers un slot vide (cas du bug remonté : pos 2 → pos 4 vide)", () => {
    // orders = [0, 1] signifie images aux positions 0 et 1, position 2 et plus vides
    expect(swapOrDropImageOrder([0, 1], 1, 3)).toEqual([0, 3]);
  });

  it("ne change rien si fromPos == toPos", () => {
    expect(swapOrDropImageOrder([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
  });

  it("ne change rien si fromPos n'est pas dans orders (slot vide)", () => {
    expect(swapOrDropImageOrder([0, 2], 1, 4)).toEqual([0, 2]);
  });

  it("préserve les autres entrées lors d'un déplacement vers un slot vide", () => {
    expect(swapOrDropImageOrder([0, 2, 4], 2, 1)).toEqual([0, 1, 4]);
  });

  it("préserve les autres entrées lors d'un swap", () => {
    expect(swapOrDropImageOrder([0, 2, 4], 0, 4)).toEqual([4, 2, 0]);
  });
});
