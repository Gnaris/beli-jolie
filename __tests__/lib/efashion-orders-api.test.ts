import { describe, it, expect } from "vitest";
import {
  normalizeEfashionStatus,
  sumLineQuantities,
} from "@/lib/efashion-orders-api";
import { EfashionOrderStatus } from "@prisma/client";

describe("efashion-orders-api — normalizeEfashionStatus", () => {
  it("mappe 2 (Commande expédiée) et 8 (Pickup) sur SHIPPED", () => {
    expect(normalizeEfashionStatus(2)).toBe(EfashionOrderStatus.SHIPPED);
    expect(normalizeEfashionStatus(8)).toBe(EfashionOrderStatus.SHIPPED);
  });

  it("mappe 3 (Annulée) sur CANCELLED", () => {
    expect(normalizeEfashionStatus(3)).toBe(EfashionOrderStatus.CANCELLED);
  });

  it("retombe sur NEW pour toute valeur inconnue — protège la déduction stock", () => {
    // Statuts intermédiaires (1, 5, 6, 7…) ne doivent PAS déclencher la déduction.
    for (const s of [0, 1, 4, 5, 6, 7, 99]) {
      expect(normalizeEfashionStatus(s)).toBe(EfashionOrderStatus.NEW);
    }
  });

  it("libellé « En attente de confirmation » → NEW (pas VALIDATED)", () => {
    // Régression : le mot "confirm" figure dans "confirmation", il ne doit pas
    // faire matcher VALIDATED. NEW doit être détecté en priorité via "attente".
    expect(normalizeEfashionStatus(1, "En attente de confirmation")).toBe(EfashionOrderStatus.NEW);
  });

  it("libellé « Commande confirmée » → VALIDATED", () => {
    expect(normalizeEfashionStatus(4, "Commande confirmée")).toBe(EfashionOrderStatus.VALIDATED);
  });

  it("libellé « Commande expédiée » → SHIPPED", () => {
    expect(normalizeEfashionStatus(2, "Commande expédiée")).toBe(EfashionOrderStatus.SHIPPED);
  });

  it("libellé « Annulée » → CANCELLED", () => {
    expect(normalizeEfashionStatus(3, "Annulée par le vendeur")).toBe(EfashionOrderStatus.CANCELLED);
  });

  it("libellé « Pickup colis effectué » → SHIPPED", () => {
    // Le regex SHIPPED exige explicitement « (pickup|colis) effectué » : sans le
    // mot « effectu », on reste en pré-expédition (VALIDATED via "pret").
    expect(normalizeEfashionStatus(8, "Pickup colis effectué")).toBe(EfashionOrderStatus.SHIPPED);
  });
});

describe("efashion-orders-api — sumLineQuantities", () => {
  it("somme q1..q12", () => {
    expect(sumLineQuantities({ q1: 2, q2: 3, q3: 0, q4: 5 })).toBe(10);
  });

  it("gère les objets vides / undefined / null", () => {
    expect(sumLineQuantities(null)).toBe(0);
    expect(sumLineQuantities(undefined)).toBe(0);
    expect(sumLineQuantities({})).toBe(0);
  });

  it("ignore les valeurs non numériques", () => {
    expect(sumLineQuantities({ q1: 5, q2: "oops" as unknown as number, q3: 3 })).toBe(8);
  });

  it("supporte q1..q12 exhaustif", () => {
    const all: Record<string, number> = {};
    for (let i = 1; i <= 12; i++) all[`q${i}`] = 1;
    expect(sumLineQuantities(all)).toBe(12);
  });

  it("ignore les clés hors du range q1..q12", () => {
    expect(sumLineQuantities({ q1: 1, q13: 100, qX: 999 })).toBe(1);
  });
});
