import { describe, it, expect } from "vitest";
import {
  parsePeriod,
  getPeriodRange,
  periodLabel,
  DEFAULT_PERIOD,
  PERIOD_OPTIONS,
} from "@/lib/dashboard-period";

describe("parsePeriod", () => {
  it("renvoie le défaut quand vide ou invalide", () => {
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod(null)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("")).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("bogus")).toBe(DEFAULT_PERIOD);
  });

  it("accepte les 5 presets", () => {
    expect(parsePeriod("7d")).toBe("7d");
    expect(parsePeriod("30d")).toBe("30d");
    expect(parsePeriod("90d")).toBe("90d");
    expect(parsePeriod("year")).toBe("year");
    expect(parsePeriod("month")).toBe("month");
  });

  it("prend la première valeur quand plusieurs query-params", () => {
    expect(parsePeriod(["30d", "7d"])).toBe("30d");
  });
});

describe("getPeriodRange", () => {
  // Référence stable pour les tests : jeudi 22 oct. 2026, 14:00 locale.
  const REF = new Date(2026, 9, 22, 14, 0, 0);

  it("7d : du mardi 16 oct. (inclus) à aujourd'hui (fin exclusive = demain 00h)", () => {
    const r = getPeriodRange("7d", REF);
    expect(r.start.getDate()).toBe(16);
    expect(r.start.getMonth()).toBe(9);
    expect(r.end.getDate()).toBe(23);
    expect(r.previousStart.getDate()).toBe(9);
    expect(r.previousEnd.getDate()).toBe(16);
    expect(r.bucketGranularity).toBe("day");
    expect(r.deltaReference).toContain("7 jours");
  });

  it("30d : fenêtre glissante + période précédente de 30j", () => {
    const r = getPeriodRange("30d", REF);
    const spanDays = (r.end.getTime() - r.start.getTime()) / 86_400_000;
    const prevSpanDays = (r.previousEnd.getTime() - r.previousStart.getTime()) / 86_400_000;
    expect(spanDays).toBe(30);
    expect(prevSpanDays).toBe(30);
    expect(r.bucketGranularity).toBe("day");
  });

  it("90d : bucket semaine", () => {
    const r = getPeriodRange("90d", REF);
    expect(r.bucketGranularity).toBe("week");
  });

  it("month : du 1er du mois courant au 1er du mois suivant", () => {
    const r = getPeriodRange("month", REF);
    expect(r.start.getDate()).toBe(1);
    expect(r.start.getMonth()).toBe(9); // octobre
    expect(r.end.getDate()).toBe(1);
    expect(r.end.getMonth()).toBe(10); // novembre
    expect(r.previousStart.getMonth()).toBe(8); // septembre
    expect(r.deltaReference).toBe("vs. mois précédent");
  });

  it("year : du 1er janvier au 1er janvier suivant + bucket mois", () => {
    const r = getPeriodRange("year", REF);
    expect(r.start.getFullYear()).toBe(2026);
    expect(r.start.getMonth()).toBe(0);
    expect(r.start.getDate()).toBe(1);
    expect(r.end.getFullYear()).toBe(2027);
    expect(r.previousStart.getFullYear()).toBe(2025);
    expect(r.bucketGranularity).toBe("month");
  });
});

describe("periodLabel + PERIOD_OPTIONS", () => {
  it("libellés en français pour chaque option", () => {
    expect(periodLabel("7d")).toBe("7 jours");
    expect(periodLabel("month")).toBe("Mois en cours");
    expect(periodLabel("year")).toBe("Année");
  });

  it("PERIOD_OPTIONS contient les 5 clés sans doublon", () => {
    expect(new Set(PERIOD_OPTIONS).size).toBe(5);
  });
});
