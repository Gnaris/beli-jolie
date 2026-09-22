import { describe, it, expect } from "vitest";
import { buildAiPrompt } from "@/lib/newsletter-ai-prompt";

describe("buildAiPrompt", () => {
  it("inclut les 4 tokens obligatoires marketing", () => {
    const p = buildAiPrompt({ description: "Un mail simple." });
    expect(p).toContain("{shopName}");
    expect(p).toContain("{shopAddress}");
    expect(p).toContain("{unsubscribeLink}");
    expect(p).toContain("{privacyLink}");
  });

  it("inclut les contraintes techniques email (table, styles inline)", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p.toLowerCase()).toContain("<table>");
    expect(p.toLowerCase()).toContain("inline");
    expect(p).toContain("600 px");
  });

  it("propose l'usage des tokens {{img.nom}} pour les images", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p).toContain("{{img.");
  });

  it("insère la description utilisateur telle quelle", () => {
    const p = buildAiPrompt({ description: "Un mail rose pour la Saint-Valentin." });
    expect(p).toContain("Un mail rose pour la Saint-Valentin.");
  });

  it("description vide → placeholder d'invitation à compléter", () => {
    const p = buildAiPrompt({ description: "" });
    expect(p).toContain("à compléter");
  });

  it("liste au moins quelques variables facultatives", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p).toContain("{firstName}");
    expect(p).toContain("{company}");
  });

  it("demande une réponse HTML complète prête à coller", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p.toLowerCase()).toContain("<!doctype");
  });

  it("interdit les URLs en dur pour les images", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p.toLowerCase()).toContain("aucune url");
    expect(p.toLowerCase()).toContain("jamais");
  });

  it("donne des exemples de noms d'images descriptifs (hero, produit-1…)", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p).toContain("hero");
    expect(p).toContain("produit-1");
  });

  it("exige un alt descriptif non vide", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p.toLowerCase()).toContain("alt");
    expect(p.toLowerCase()).toContain("jamais vide");
  });

  it("précise les dimensions recommandées (hero 600, colonnes, logo…)", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p).toContain(`width="600"`); // hero
    expect(p).toContain(`width="180"`); // vignette 3 colonnes
    expect(p.toLowerCase()).toContain("outlook");
  });

  it("recommande width HTML explicite (pas seulement CSS)", () => {
    const p = buildAiPrompt({ description: "x" });
    expect(p).toContain(`attribut HTML \`width=`);
  });

  describe("prompt scénario-aware", () => {
    it("scenario=null : pas de section scénario", () => {
      const p = buildAiPrompt({ description: "x", scenario: null });
      expect(p).not.toContain("PANIER ABANDONNÉ");
      expect(p).not.toContain("INACTIVITÉ");
    });

    it("ABANDONED_CART : ajoute section + syntaxe {{#each cart}}", () => {
      const p = buildAiPrompt({ description: "x", scenario: "ABANDONED_CART" });
      expect(p).toContain("PANIER ABANDONNÉ");
      expect(p).toContain("{{#each cart}}");
      expect(p).toContain("{{/each}}");
      expect(p).toContain("{cartTotal}");
      expect(p).toContain("{name}");
      expect(p).toContain("{qty}");
    });

    it("INACTIVE_CLIENT : ajoute section + token {days}", () => {
      const p = buildAiPrompt({ description: "x", scenario: "INACTIVE_CLIENT" });
      expect(p).toContain("INACTIVITÉ");
      expect(p).toContain("{days}");
      expect(p).not.toContain("{{#each cart}}");
    });

    it("RESTOCK : ajoute section + syntaxe {{#each favorites}}", () => {
      const p = buildAiPrompt({ description: "x", scenario: "RESTOCK" });
      expect(p).toContain("RETOUR EN STOCK");
      expect(p).toContain("{{#each favorites}}");
      expect(p).toContain("{favoritesCount}");
      expect(p).toContain("{price}");
    });
  });
});
