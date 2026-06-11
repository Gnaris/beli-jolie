import { describe, it, expect } from "vitest";
import { nextAvailableOrder } from "@/lib/import-processor";

describe("nextAvailableOrder", () => {
  it("retourne la position cible si elle est libre", () => {
    expect(nextAvailableOrder(0, new Set())).toBe(0);
    expect(nextAvailableOrder(2, new Set([0, 1]))).toBe(2);
    expect(nextAvailableOrder(3, new Set([0, 1, 5]))).toBe(3);
  });

  it("glisse vers le haut quand la position cible est occupée", () => {
    expect(nextAvailableOrder(0, new Set([0]))).toBe(1);
    expect(nextAvailableOrder(0, new Set([0, 1]))).toBe(2);
    expect(nextAvailableOrder(1, new Set([1, 2, 3]))).toBe(4);
  });

  it("trouve la prochaine position libre en sautant les trous", () => {
    expect(nextAvailableOrder(0, new Set([0, 1, 2, 4]))).toBe(3);
    expect(nextAvailableOrder(2, new Set([2, 3, 5]))).toBe(4);
  });

  it("traite une cible négative comme 0", () => {
    expect(nextAvailableOrder(-1, new Set())).toBe(0);
    expect(nextAvailableOrder(-3, new Set([0]))).toBe(1);
  });
});
