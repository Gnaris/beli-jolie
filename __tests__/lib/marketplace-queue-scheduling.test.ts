/**
 * __tests__/lib/marketplace-queue-scheduling.test.ts
 *
 * Vérifie la logique d'étalement des jobs marketplace :
 *  - intervalMs = 0 → tous les scheduledFor à null
 *  - N produits × M marketplaces → N groupes chronologiques
 *  - Le 1er produit garde scheduledFor = null (démarre immédiatement)
 */
import { describe, it, expect } from "vitest";
import { computeScheduledTimestamps } from "@/lib/marketplace-queue-scheduling";

const BASELINE = new Date("2026-07-04T09:00:00.000Z");

describe("computeScheduledTimestamps", () => {
  it("retourne tous les scheduledFor à null quand intervalMs = 0", () => {
    const ids = ["p1", "p1", "p2", "p3"];
    const res = computeScheduledTimestamps(ids, 0, BASELINE);
    expect(res).toEqual([null, null, null, null]);
  });

  it("retourne tous les scheduledFor à null quand intervalMs est négatif", () => {
    const ids = ["p1", "p2"];
    const res = computeScheduledTimestamps(ids, -1000, BASELINE);
    expect(res).toEqual([null, null]);
  });

  it("retourne un tableau vide pour une liste vide", () => {
    expect(computeScheduledTimestamps([], 10_000, BASELINE)).toEqual([]);
  });

  it("étale les produits distincts par groupe chronologique", () => {
    // 3 produits distincts, chacun avec 1 seul item → 3 groupes.
    const ids = ["p1", "p2", "p3"];
    const interval = 10 * 60_000; // 10 min
    const res = computeScheduledTimestamps(ids, interval, BASELINE);
    expect(res[0]).toBeNull(); // 1er = immédiat
    expect(res[1]).toEqual(new Date(BASELINE.getTime() + interval));
    expect(res[2]).toEqual(new Date(BASELINE.getTime() + 2 * interval));
  });

  it("regroupe les items d'un même produit sur la même heure de départ", () => {
    // p1 avec 2 marketplaces (PFS + Ankorstore), puis p2 avec 3 marketplaces.
    const ids = ["p1", "p1", "p2", "p2", "p2"];
    const interval = 5 * 60_000; // 5 min
    const res = computeScheduledTimestamps(ids, interval, BASELINE);
    // p1 = index 0 → null (immédiat)
    expect(res[0]).toBeNull();
    expect(res[1]).toBeNull();
    // p2 = index 1 → baseline + 5 min
    const p2Time = new Date(BASELINE.getTime() + interval);
    expect(res[2]).toEqual(p2Time);
    expect(res[3]).toEqual(p2Time);
    expect(res[4]).toEqual(p2Time);
  });

  it("préserve l'ordre d'apparition même si un produit revient plus tard", () => {
    // p1, p2, p1 — le second p1 hérite du groupe 0.
    const ids = ["p1", "p2", "p1"];
    const interval = 60_000;
    const res = computeScheduledTimestamps(ids, interval, BASELINE);
    expect(res[0]).toBeNull(); // p1 = groupe 0
    expect(res[1]).toEqual(new Date(BASELINE.getTime() + interval)); // p2 = groupe 1
    expect(res[2]).toBeNull(); // p1 = groupe 0 (même heure)
  });

  it("supporte 100 produits sans dérive", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const interval = 60_000;
    const res = computeScheduledTimestamps(ids, interval, BASELINE);
    expect(res[0]).toBeNull();
    expect(res[99]).toEqual(new Date(BASELINE.getTime() + 99 * interval));
  });
});
