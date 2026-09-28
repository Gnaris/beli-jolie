/**
 * Tests du tokeniseur markdown WhatsApp utilisé par l'aperçu du drawer.
 *
 * On teste uniquement la fonction de tokenisation (pure, sans React). Le
 * rendu des tokens en JSX est trivial et couvert implicitement par le
 * composant qui les consomme.
 */

import { describe, it, expect } from "vitest";

import { tokenizeWhatsAppMarkdown } from "@/lib/whatsapp-markdown";

describe("tokenizeWhatsAppMarkdown — gras", () => {
  it("détecte *texte* comme un token bold", () => {
    const tokens = tokenizeWhatsAppMarkdown("Bonjour *Marie*");
    expect(tokens).toEqual([
      { kind: "text", content: "Bonjour " },
      { kind: "bold", content: "Marie" },
    ]);
  });

  it("détecte un mot d'un seul caractère", () => {
    const tokens = tokenizeWhatsAppMarkdown("*!*");
    expect(tokens).toEqual([{ kind: "bold", content: "!" }]);
  });

  it("ne match pas si les délimiteurs sont entourés d'espaces", () => {
    // « 2 * 3 = 6 » — les * sont entourés d'espaces
    const tokens = tokenizeWhatsAppMarkdown("2 * 3 = 6");
    expect(tokens).toEqual([{ kind: "text", content: "2 * 3 = 6" }]);
  });

  it("gère plusieurs mises en gras dans la même ligne", () => {
    const tokens = tokenizeWhatsAppMarkdown("*Bonjour* Marie, *à bientôt*");
    expect(tokens).toEqual([
      { kind: "bold", content: "Bonjour" },
      { kind: "text", content: " Marie, " },
      { kind: "bold", content: "à bientôt" },
    ]);
  });
});

describe("tokenizeWhatsAppMarkdown — italique", () => {
  it("détecte _texte_ comme italic", () => {
    const tokens = tokenizeWhatsAppMarkdown("_important_");
    expect(tokens).toEqual([{ kind: "italic", content: "important" }]);
  });

  it("ne match pas _texte_ avec espaces bordants", () => {
    const tokens = tokenizeWhatsAppMarkdown("_ pas italique _");
    expect(tokens).toEqual([{ kind: "text", content: "_ pas italique _" }]);
  });
});

describe("tokenizeWhatsAppMarkdown — barré", () => {
  it("détecte ~texte~ comme strike", () => {
    const tokens = tokenizeWhatsAppMarkdown("~annulé~");
    expect(tokens).toEqual([{ kind: "strike", content: "annulé" }]);
  });
});

describe("tokenizeWhatsAppMarkdown — code", () => {
  it("détecte ```texte``` comme code", () => {
    const tokens = tokenizeWhatsAppMarkdown("```const x = 1```");
    expect(tokens).toEqual([{ kind: "code", content: "const x = 1" }]);
  });

  it("autorise les sauts de ligne dans un bloc code", () => {
    const tokens = tokenizeWhatsAppMarkdown("```ligne1\nligne2```");
    expect(tokens).toEqual([{ kind: "code", content: "ligne1\nligne2" }]);
  });
});

describe("tokenizeWhatsAppMarkdown — sauts de ligne", () => {
  it("émet un token linebreak entre chaque ligne", () => {
    const tokens = tokenizeWhatsAppMarkdown("Ligne 1\nLigne 2");
    expect(tokens).toEqual([
      { kind: "text", content: "Ligne 1" },
      { kind: "linebreak" },
      { kind: "text", content: "Ligne 2" },
    ]);
  });

  it("préserve les paragraphes multiples", () => {
    const tokens = tokenizeWhatsAppMarkdown("a\n\nb");
    expect(tokens).toEqual([
      { kind: "text", content: "a" },
      { kind: "linebreak" },
      { kind: "linebreak" },
      { kind: "text", content: "b" },
    ]);
  });
});

describe("tokenizeWhatsAppMarkdown — cas combinés", () => {
  it("gère un modèle réaliste avec variables déjà rendues", () => {
    const template = "*Bonjour Marie* 👋\nNouvelle _collection_ arrivée !";
    const tokens = tokenizeWhatsAppMarkdown(template);
    expect(tokens).toEqual([
      { kind: "bold", content: "Bonjour Marie" },
      { kind: "text", content: " 👋" },
      { kind: "linebreak" },
      { kind: "text", content: "Nouvelle " },
      { kind: "italic", content: "collection" },
      { kind: "text", content: " arrivée !" },
    ]);
  });

  it("retourne un tableau vide pour une entrée vide", () => {
    expect(tokenizeWhatsAppMarkdown("")).toEqual([]);
  });
});
