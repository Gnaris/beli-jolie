/**
 * Tests des helpers de formatage de dates utilisés par la cellule "Dates" du
 * tableau admin produits (ProductDatesCell).
 *
 * On teste formatRelativeDate pour ses 5 branches (auj./hier/Xj/mois/annee)
 * et wasMeaningfullyUpdated pour le seuil de 60s qui distingue une vraie
 * modification d'une simple insertion (Prisma met updatedAt = createdAt
 * a l'insert).
 */

import { describe, it, expect } from "vitest";

import {
  formatExportTooltip,
  formatRelativeDate,
  wasMeaningfullyUpdated,
} from "@/components/admin/products/AdminProductsTable";

const NOW = new Date("2026-06-12T15:00:00.000Z");

describe("formatRelativeDate", () => {
  it("affiche 'auj.' pour aujourd'hui", () => {
    expect(formatRelativeDate("2026-06-12T08:30:00.000Z", NOW)).toBe("auj.");
  });

  it("affiche 'hier' pour le jour précédent", () => {
    expect(formatRelativeDate("2026-06-11T20:00:00.000Z", NOW)).toBe("hier");
  });

  it("affiche 'il y a Nj' pour 2 à 6 jours", () => {
    expect(formatRelativeDate("2026-06-10T08:00:00.000Z", NOW)).toBe("il y a 2j");
    expect(formatRelativeDate("2026-06-06T08:00:00.000Z", NOW)).toBe("il y a 6j");
  });

  it("affiche 'JJ mois' pour le reste de l'année courante", () => {
    const out = formatRelativeDate("2026-04-15T08:00:00.000Z", NOW);
    expect(out).toMatch(/15/);
    expect(out).toMatch(/avr/);
    expect(out).not.toMatch(/2026/);
  });

  it("affiche 'JJ mois AAAA' pour une année différente", () => {
    const out = formatRelativeDate("2024-12-03T08:00:00.000Z", NOW);
    expect(out).toMatch(/03|3/);
    expect(out).toMatch(/déc/);
    expect(out).toMatch(/2024/);
  });

  it("retourne — pour une ISO invalide", () => {
    expect(formatRelativeDate("pas une date", NOW)).toBe("—");
  });

  it("compare en jours calendaires locaux (frontière de jour cohérente avec l'admin)", () => {
    // updated explicitement au début du 11 juin (matin) → forcément la veille
    // peu importe le fuseau horaire d'exécution des tests.
    const updated = "2026-06-11T08:00:00.000Z";
    const localNow = new Date("2026-06-12T15:00:00.000Z");
    expect(formatRelativeDate(updated, localNow)).toBe("hier");
  });
});

describe("wasMeaningfullyUpdated", () => {
  it("retourne false quand updatedAt = createdAt (insert frais)", () => {
    const ts = "2026-06-12T10:00:00.000Z";
    expect(wasMeaningfullyUpdated(ts, ts)).toBe(false);
  });

  it("retourne false si l'écart est ≤ 60 secondes (race-condition Prisma)", () => {
    const created = "2026-06-12T10:00:00.000Z";
    const updated = "2026-06-12T10:00:45.000Z";
    expect(wasMeaningfullyUpdated(created, updated)).toBe(false);
  });

  it("retourne true si l'écart dépasse 60 secondes", () => {
    const created = "2026-06-12T10:00:00.000Z";
    const updated = "2026-06-12T10:02:00.000Z";
    expect(wasMeaningfullyUpdated(created, updated)).toBe(true);
  });

  it("retourne true pour une modification largement postérieure", () => {
    const created = "2026-05-01T10:00:00.000Z";
    const updated = "2026-06-12T10:00:00.000Z";
    expect(wasMeaningfullyUpdated(created, updated)).toBe(true);
  });

  it("retourne false sur input invalide", () => {
    expect(wasMeaningfullyUpdated("oups", "2026-06-12T10:00:00.000Z")).toBe(false);
    expect(wasMeaningfullyUpdated("2026-06-12T10:00:00.000Z", "oups")).toBe(false);
  });
});

describe("formatExportTooltip", () => {
  it("retourne 'Jamais exporté…' quand la date est null", () => {
    expect(formatExportTooltip(null, "Paris Fashion Shop")).toBe(
      "Jamais exporté vers Paris Fashion Shop depuis l'admin.",
    );
  });

  it("inclut le libellé de la marketplace et la date au format FR longue", () => {
    const out = formatExportTooltip("2026-06-12T10:30:00.000Z", "Ankorstore");
    expect(out).toMatch(/^Dernier export vers Ankorstore le /);
    // On vérifie la présence du jour, mois en français long, année et heure
    expect(out).toMatch(/12/);
    expect(out).toMatch(/juin/);
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/\.$/);
  });

  it("tombe sur 'Jamais exporté…' si la date est invalide (défense)", () => {
    expect(formatExportTooltip("pas une date", "eFashion")).toBe(
      "Jamais exporté vers eFashion depuis l'admin.",
    );
  });
});
