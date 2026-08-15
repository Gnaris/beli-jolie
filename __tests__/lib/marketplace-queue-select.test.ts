/**
 * __tests__/lib/marketplace-queue-select.test.ts
 *
 * Vérifie la logique de sélection des jobs dans la file marketplace :
 *  - Respect du budget total
 *  - Respect du budget Ankor dédié
 *  - Verrou de sérialisation par produit côté Ankor (nouveau 2026-08-15)
 *  - Absence d'impact sur les autres marketplaces (PFS/eFashion/Faire)
 */
import { describe, it, expect } from "vitest";
import { selectJobsToStart } from "@/lib/marketplace-queue-select";

type Job = { id: string; marketplace: string; productId: string };

function job(id: string, marketplace: string, productId: string): Job {
  return { id, marketplace, productId };
}

describe("selectJobsToStart", () => {
  it("respecte le budget total", () => {
    const queued: Job[] = [
      job("j1", "PFS", "p1"),
      job("j2", "PFS", "p2"),
      job("j3", "PFS", "p3"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 2,
      ankorsBudget: 5,
    });
    expect(res.map((j) => j.id)).toEqual(["j1", "j2"]);
  });

  it("respecte le budget Ankor dédié (max 5 jobs Ankor en parallèle)", () => {
    const queued: Job[] = Array.from({ length: 8 }, (_, i) =>
      job(`a${i}`, "ANKORSTORE", `p${i}`),
    );
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
    });
    expect(res).toHaveLength(5);
    expect(res.every((j) => j.marketplace === "ANKORSTORE")).toBe(true);
  });

  it("5 produits Ankor distincts partent tous en parallèle", () => {
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "prodA"),
      job("a2", "ANKORSTORE", "prodB"),
      job("a3", "ANKORSTORE", "prodC"),
      job("a4", "ANKORSTORE", "prodD"),
      job("a5", "ANKORSTORE", "prodE"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
    });
    expect(res.map((j) => j.id)).toEqual(["a1", "a2", "a3", "a4", "a5"]);
  });

  it("2 jobs Ankor sur le même produit → 1 seul démarre (verrou par produit)", () => {
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "prodA"),
      job("a2", "ANKORSTORE", "prodA"), // même produit → skip
      job("a3", "ANKORSTORE", "prodB"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
    });
    expect(res.map((j) => j.id)).toEqual(["a1", "a3"]);
  });

  it("bloque un job Ankor si un autre job Ankor sur ce produit est déjà en vol", () => {
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "prodA"), // en vol → skip
      job("a2", "ANKORSTORE", "prodB"), // ok
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: ["prodA"],
      totalBudget: 10,
      ankorsBudget: 5,
    });
    expect(res.map((j) => j.id)).toEqual(["a2"]);
  });

  it("le verrou par produit ne s'applique QU'à Ankor (les autres marketplaces passent)", () => {
    // PFS et Ankor sur le même produit doivent pouvoir tourner en même temps :
    // le verrou couvre Ankor↔Ankor uniquement.
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "prodA"),
      job("p1", "PFS", "prodA"),
      job("e1", "EFASHION", "prodA"),
      job("f1", "FAIRE", "prodA"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: ["prodA"], // Ankor sur prodA déjà en vol
      totalBudget: 10,
      ankorsBudget: 5,
    });
    // a1 est skip (verrou), mais p1/e1/f1 passent car pas concernés.
    expect(res.map((j) => j.id)).toEqual(["p1", "e1", "f1"]);
  });

  it("consomme le budget total ET le budget Ankor de façon cohérente", () => {
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "p1"),
      job("a2", "ANKORSTORE", "p2"),
      job("p1", "PFS", "p3"),
      job("a3", "ANKORSTORE", "p4"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 3,
      ankorsBudget: 5,
    });
    // totalBudget = 3 → on prend a1, a2, p1 puis on arrête (budget total atteint).
    expect(res.map((j) => j.id)).toEqual(["a1", "a2", "p1"]);
  });

  it("saute les jobs Ankor quand ankorsBudget = 0 mais laisse passer les autres", () => {
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "p1"), // skip (budget Ankor 0)
      job("p1", "PFS", "p2"),
      job("a2", "ANKORSTORE", "p3"), // skip
      job("f1", "FAIRE", "p4"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 0,
    });
    expect(res.map((j) => j.id)).toEqual(["p1", "f1"]);
  });

  it("retourne un tableau vide si aucun budget", () => {
    const queued: Job[] = [job("a1", "ANKORSTORE", "p1")];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 0,
      ankorsBudget: 5,
    });
    expect(res).toEqual([]);
  });

  it("retourne un tableau vide si file vide", () => {
    const res = selectJobsToStart({
      queued: [],
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
    });
    expect(res).toEqual([]);
  });

  it("respecte le budget Faire dédié (max 2 jobs Faire en parallèle)", () => {
    const queued: Job[] = Array.from({ length: 5 }, (_, i) =>
      job(`f${i}`, "FAIRE", `p${i}`),
    );
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
      fairesBudget: 2,
    });
    expect(res.map((j) => j.id)).toEqual(["f0", "f1"]);
  });

  it("saute les jobs Faire quand fairesBudget = 0 mais laisse passer les autres", () => {
    const queued: Job[] = [
      job("f1", "FAIRE", "p1"), // skip (budget Faire 0)
      job("p1", "PFS", "p2"),
      job("f2", "FAIRE", "p3"), // skip
      job("a1", "ANKORSTORE", "p4"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
      fairesBudget: 0,
    });
    expect(res.map((j) => j.id)).toEqual(["p1", "a1"]);
  });

  it("fairesBudget omis → aucune limite Faire (rétro-compat avec anciens callsites)", () => {
    const queued: Job[] = Array.from({ length: 6 }, (_, i) =>
      job(`f${i}`, "FAIRE", `p${i}`),
    );
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
      // fairesBudget absent volontairement
    });
    expect(res).toHaveLength(6);
  });

  it("les budgets Ankor et Faire sont indépendants", () => {
    const queued: Job[] = [
      job("a1", "ANKORSTORE", "pA1"),
      job("f1", "FAIRE", "pF1"),
      job("a2", "ANKORSTORE", "pA2"),
      job("f2", "FAIRE", "pF2"),
      job("a3", "ANKORSTORE", "pA3"),
      job("f3", "FAIRE", "pF3"), // skip (Faire budget épuisé après f1/f2)
      job("p1", "PFS", "pP1"),
    ];
    const res = selectJobsToStart({
      queued,
      inFlightAnkorProductIds: [],
      totalBudget: 10,
      ankorsBudget: 5,
      fairesBudget: 2,
    });
    expect(res.map((j) => j.id)).toEqual(["a1", "f1", "a2", "f2", "a3", "p1"]);
  });

  it("ne mute pas le Set inFlight passé en entrée", () => {
    const inFlight = new Set(["prodA"]);
    selectJobsToStart({
      queued: [job("a1", "ANKORSTORE", "prodB"), job("a2", "ANKORSTORE", "prodC")],
      inFlightAnkorProductIds: inFlight,
      totalBudget: 10,
      ankorsBudget: 5,
    });
    // Le Set original ne doit contenir QUE prodA après l'appel (les productIds
    // sélectionnés dans ce tick sont mémorisés dans une COPIE interne).
    expect(Array.from(inFlight)).toEqual(["prodA"]);
  });
});
