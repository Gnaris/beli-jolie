import { describe, it, expect } from "vitest";
import { parseHomeFaq, resolveHomeFaqForLocale, type HomeFaqItem } from "@/lib/home-faq";

describe("parseHomeFaq — champs EN", () => {
  it("lit questionEn / answerEn quand présents", () => {
    const raw = JSON.stringify([
      {
        id: "faq-1",
        question: "Question FR",
        answer: "Réponse FR",
        questionEn: "Question EN",
        answerEn: "Answer EN",
      },
    ]);
    const items = parseHomeFaq(raw);
    expect(items).toHaveLength(1);
    expect(items[0].questionEn).toBe("Question EN");
    expect(items[0].answerEn).toBe("Answer EN");
  });

  it("ne pose pas les clés questionEn / answerEn si absentes (compat historique)", () => {
    const raw = JSON.stringify([{ id: "faq-1", question: "Q", answer: "A" }]);
    const items = parseHomeFaq(raw);
    expect(items[0].questionEn).toBeUndefined();
    expect(items[0].answerEn).toBeUndefined();
  });
});

describe("resolveHomeFaqForLocale", () => {
  const withEn: HomeFaqItem = {
    id: "1",
    question: "Question FR",
    answer: "Réponse FR",
    questionEn: "Question EN",
    answerEn: "Answer EN",
  };
  const withoutEn: HomeFaqItem = {
    id: "2",
    question: "Question FR",
    answer: "Réponse FR",
  };
  const halfEn: HomeFaqItem = {
    id: "3",
    question: "Question FR",
    answer: "Réponse FR",
    questionEn: "Question EN",
    // answerEn absent — fallback partiel
  };

  it("retourne le tableau tel quel en locale fr", () => {
    const result = resolveHomeFaqForLocale([withEn, withoutEn], "fr");
    expect(result[0].question).toBe("Question FR");
    expect(result[1].question).toBe("Question FR");
  });

  it("bascule question/answer en EN quand traduction complète", () => {
    const result = resolveHomeFaqForLocale([withEn], "en");
    expect(result[0].question).toBe("Question EN");
    expect(result[0].answer).toBe("Answer EN");
  });

  it("garde le FR quand aucune traduction EN saisie", () => {
    const result = resolveHomeFaqForLocale([withoutEn], "en");
    expect(result[0].question).toBe("Question FR");
    expect(result[0].answer).toBe("Réponse FR");
  });

  it("mixe : question EN saisie, réponse pas saisie → answer FR conservée", () => {
    const result = resolveHomeFaqForLocale([halfEn], "en");
    expect(result[0].question).toBe("Question EN");
    expect(result[0].answer).toBe("Réponse FR");
  });

  it("gère un tableau vide sans planter", () => {
    expect(resolveHomeFaqForLocale([], "en")).toEqual([]);
  });
});
