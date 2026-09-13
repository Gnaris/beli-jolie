import { describe, it, expect } from "vitest";
import {
  parseHomeFaq,
  buildFaqJsonLd,
  MAX_HOME_FAQ_ITEMS,
  DEFAULT_HOME_FAQ_ITEMS,
} from "@/lib/home-faq";

describe("parseHomeFaq", () => {
  it("retourne [] pour null / undefined / chaîne vide", () => {
    expect(parseHomeFaq(null)).toEqual([]);
    expect(parseHomeFaq(undefined)).toEqual([]);
    expect(parseHomeFaq("")).toEqual([]);
  });

  it("retourne [] pour JSON invalide (pas de crash)", () => {
    expect(parseHomeFaq("not json")).toEqual([]);
    expect(parseHomeFaq("{oops}")).toEqual([]);
  });

  it("retourne [] pour un JSON qui n'est pas un tableau", () => {
    expect(parseHomeFaq("{}")).toEqual([]);
    expect(parseHomeFaq('"hello"')).toEqual([]);
  });

  it("parse un item FAQ complet valide", () => {
    const raw = JSON.stringify([
      { id: "faq-0", question: "Livraison ?", answer: "Sous 48 h ouvrées." },
    ]);
    expect(parseHomeFaq(raw)).toEqual([
      { id: "faq-0", question: "Livraison ?", answer: "Sous 48 h ouvrées." },
    ]);
  });

  it("filtre les items sans question ou sans réponse", () => {
    const raw = JSON.stringify([
      { question: "OK", answer: "réponse OK" },
      { question: "", answer: "sans question" },
      { question: "Sans réponse", answer: "" },
      { question: "   ", answer: "   " },
    ]);
    const items = parseHomeFaq(raw);
    expect(items).toHaveLength(1);
    expect(items[0]?.question).toBe("OK");
  });

  it(`limite à ${MAX_HOME_FAQ_ITEMS} items (les excédents sont ignorés)`, () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      question: `Question ${i} ?`,
      answer: `Réponse ${i}`,
    }));
    const parsed = parseHomeFaq(JSON.stringify(items));
    expect(parsed).toHaveLength(MAX_HOME_FAQ_ITEMS);
    expect(parsed[0]?.question).toBe("Question 0 ?");
    expect(parsed[MAX_HOME_FAQ_ITEMS - 1]?.question).toBe(
      `Question ${MAX_HOME_FAQ_ITEMS - 1} ?`,
    );
  });

  it("génère un id de fallback si absent, préserve l'id fourni", () => {
    const raw = JSON.stringify([
      { question: "A", answer: "a" },
      { id: "custom-id", question: "B", answer: "b" },
    ]);
    const items = parseHomeFaq(raw);
    expect(items[0]?.id).toBe("faq-0");
    expect(items[1]?.id).toBe("custom-id");
  });

  it("trim les questions et réponses", () => {
    const raw = JSON.stringify([
      { question: "  Question ?  ", answer: "  Réponse.  " },
    ]);
    const items = parseHomeFaq(raw);
    expect(items[0]).toMatchObject({
      question: "Question ?",
      answer: "Réponse.",
    });
  });

  it("ignore les entrées non-objet (null, string, number)", () => {
    const raw = JSON.stringify([
      null,
      "hello",
      42,
      { question: "Valide", answer: "ok" },
    ]);
    expect(parseHomeFaq(raw)).toHaveLength(1);
  });
});

describe("buildFaqJsonLd", () => {
  it("génère le schema.org FAQPage attendu", () => {
    const items = [
      { id: "a", question: "Q1", answer: "A1" },
      { id: "b", question: "Q2", answer: "A2" },
    ];
    const jsonLd = buildFaqJsonLd(items);
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1", acceptedAnswer: { "@type": "Answer", text: "A1" } },
        { "@type": "Question", name: "Q2", acceptedAnswer: { "@type": "Answer", text: "A2" } },
      ],
    });
  });

  it("gère une liste vide (mainEntity: [])", () => {
    expect(buildFaqJsonLd([])).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [],
    });
  });
});

describe("DEFAULT_HOME_FAQ_ITEMS", () => {
  it("expose exactement 4 questions par défaut", () => {
    expect(DEFAULT_HOME_FAQ_ITEMS).toHaveLength(4);
  });

  it("les défauts passent le parser sans être filtrés", () => {
    const raw = JSON.stringify(DEFAULT_HOME_FAQ_ITEMS);
    expect(parseHomeFaq(raw)).toHaveLength(4);
  });
});
