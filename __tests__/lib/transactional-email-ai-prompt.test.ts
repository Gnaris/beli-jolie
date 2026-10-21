import { describe, it, expect } from "vitest";
import { buildTransactionalAiPrompt } from "@/lib/transactional-email-ai-prompt";
import {
  TRANSACTIONAL_SCENARIOS,
  getScenarioMeta,
} from "@/lib/transactional-email-scenarios";

describe("buildTransactionalAiPrompt", () => {
  it("inclut le label et le ton attendu du scénario", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "LOGIN_OTP",
      description: "Ajoute un emoji 🔑 dans le sujet",
    });
    const meta = getScenarioMeta("LOGIN_OTP")!;
    expect(prompt).toContain(meta.label);
    expect(prompt).toContain(meta.aiTone);
  });

  it("liste chaque variable obligatoire comme OBLIGATOIRE", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "ORDER_CREATED",
      description: "",
    });
    // Les trois variables obligatoires d'ORDER_CREATED : orderNumber, itemsHtml, totalsHtml
    expect(prompt).toContain("OBLIGATOIRES");
    expect(prompt).toContain("{orderNumber}");
    expect(prompt).toContain("{itemsHtml}");
    expect(prompt).toContain("{totalsHtml}");
  });

  it("inclut la description libre", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "LOGIN_OTP",
      description: "Mettre le code en rouge et plus gros",
    });
    expect(prompt).toContain("Mettre le code en rouge et plus gros");
  });

  it("accepte un sujet actuel pour contexte", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "LOGIN_OTP",
      description: "",
      currentSubject: "Votre code — Beli",
    });
    expect(prompt).toContain("Votre code — Beli");
  });

  it("exige du HTML pur en retour (pas de ```html)", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "LOGIN_OTP",
      description: "",
    });
    expect(prompt).toContain("Renvoie UNIQUEMENT le code HTML");
  });

  it("couvre tous les scénarios du registre sans crash", () => {
    for (const scenario of TRANSACTIONAL_SCENARIOS) {
      const prompt = buildTransactionalAiPrompt({
        scenarioKey: scenario.key,
        description: "ajuste le ton",
      });
      expect(prompt.length).toBeGreaterThan(100);
    }
  });

  it("annote chaque variable avec son type (texte / lien / bloc HTML)", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "ORDER_CREATED",
      description: "",
    });
    // Classification auto : orderNumber = texte, orderUrl = lien, itemsHtml = bloc.
    expect(prompt).toContain("{orderNumber}");
    expect(prompt).toContain("[Texte]");
    expect(prompt).toContain("{orderUrl}");
    expect(prompt).toContain("[Lien (URL)]");
    expect(prompt).toContain("{itemsHtml}");
    expect(prompt).toContain("[Bloc HTML]");
  });

  it("inclut une ligne « Comment l'utiliser » pour chaque variable", () => {
    const prompt = buildTransactionalAiPrompt({
      scenarioKey: "PASSWORD_RESET",
      description: "",
    });
    expect(prompt).toContain("Comment l'utiliser");
    expect(prompt).toMatch(/href=.*\{resetUrl\}/);
  });
});
