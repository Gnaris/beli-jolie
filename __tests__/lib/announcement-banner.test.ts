import { describe, it, expect } from "vitest";
import {
  normalizeAnnouncementMessages,
  resolveLocalizedMessages,
} from "@/lib/announcement-banner";

describe("normalizeAnnouncementMessages — migration ancien format", () => {
  it("convertit un ancien tableau string[] en objets { fr } uniquement", () => {
    const raw = [
      "Livraison offerte dès 100 €",
      "Nouveautés chaque semaine",
    ];
    expect(normalizeAnnouncementMessages(raw)).toEqual([
      { fr: "Livraison offerte dès 100 €" },
      { fr: "Nouveautés chaque semaine" },
    ]);
  });

  it("garde les objets { fr, en } tels quels quand la traduction est là", () => {
    const raw = [
      { fr: "Livraison offerte", en: "Free shipping" },
      { fr: "Nouveautés" }, // pas encore traduit
    ];
    expect(normalizeAnnouncementMessages(raw)).toEqual([
      { fr: "Livraison offerte", en: "Free shipping" },
      { fr: "Nouveautés" },
    ]);
  });

  it("trim les chaînes et jette les entrées vides ou mal formées", () => {
    const raw = [
      "  Message avec espaces  ",
      "",
      { fr: "  Autre message  ", en: "  Other message  " },
      { fr: "" }, // FR vide → rejeté
      { en: "Sans FR" }, // pas de FR → rejeté
      null,
      42,
    ];
    expect(normalizeAnnouncementMessages(raw)).toEqual([
      { fr: "Message avec espaces" },
      { fr: "Autre message", en: "Other message" },
    ]);
  });

  it("renvoie tableau vide sur entrée non-array", () => {
    expect(normalizeAnnouncementMessages(null)).toEqual([]);
    expect(normalizeAnnouncementMessages(undefined)).toEqual([]);
    expect(normalizeAnnouncementMessages("chaîne isolée")).toEqual([]);
    expect(normalizeAnnouncementMessages({})).toEqual([]);
  });
});

describe("resolveLocalizedMessages — choix de la locale au rendu", () => {
  const messages = [
    { fr: "Livraison offerte", en: "Free shipping" },
    { fr: "Nouveautés" }, // pas de traduction EN
    { fr: "Commande min 100 €", en: "Min order €100" },
  ];

  it("renvoie les chaînes FR quand la locale est fr", () => {
    expect(resolveLocalizedMessages(messages, "fr")).toEqual([
      "Livraison offerte",
      "Nouveautés",
      "Commande min 100 €",
    ]);
  });

  it("renvoie EN quand présent et retombe sur FR sinon", () => {
    expect(resolveLocalizedMessages(messages, "en")).toEqual([
      "Free shipping",
      "Nouveautés", // fallback FR car pas de traduction
      "Min order €100",
    ]);
  });

  it("filtre les messages dont le fr résolu est vide (après trim)", () => {
    // La normalisation en amont supprime déjà les entrées sans FR.
    // Ce test protège le fallback : si un jour un `en` seul se glissait
    // ici, on ne veut pas afficher une chaîne vide.
    const withEmpty = [
      { fr: "OK", en: "OK EN" },
      { fr: "   " }, // ne devrait pas survivre à la normalisation
    ];
    expect(resolveLocalizedMessages(withEmpty, "fr")).toEqual(["OK"]);
    expect(resolveLocalizedMessages(withEmpty, "en")).toEqual(["OK EN"]);
  });
});
