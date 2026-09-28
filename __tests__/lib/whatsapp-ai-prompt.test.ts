import { describe, it, expect } from "vitest";
import { buildWhatsAppAiPrompt } from "@/lib/whatsapp-ai-prompt";
import { WHATSAPP_VARIABLES } from "@/lib/whatsapp-message";

describe("buildWhatsAppAiPrompt", () => {
  it("insère la description utilisateur telle quelle", () => {
    const p = buildWhatsAppAiPrompt({ description: "Message de bienvenue pour un nouveau client." });
    expect(p).toContain("Message de bienvenue pour un nouveau client.");
  });

  it("description vide → placeholder d'invitation à compléter", () => {
    const p = buildWhatsAppAiPrompt({ description: "" });
    expect(p).toContain("à compléter");
  });

  it("liste TOUTES les variables WhatsApp disponibles", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    for (const v of WHATSAPP_VARIABLES) {
      expect(p, `variable {${v.token}} manquante dans le prompt`).toContain(`{${v.token}}`);
    }
  });

  it("cite la contrainte de longueur 1000 caractères", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    expect(p).toContain("1000");
  });

  it("explique le formatage WhatsApp (gras, italique, barré)", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    // On documente les 3 marqueurs WhatsApp via *texte* / _texte_ / ~texte~
    expect(p).toContain("*texte*");
    expect(p).toContain("_texte_");
    expect(p).toContain("~texte~");
  });

  it("interdit les liens Markdown [texte](url)", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    expect(p).toContain("[texte](url)");
  });

  it("précise que les URL doivent être en clair", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    expect(p.toLowerCase()).toContain("url");
    expect(p.toLowerCase()).toContain("cliquable");
  });

  it("recommande une signature avec {adminFirstName}", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    expect(p).toContain("{adminFirstName}");
  });

  it("ne contient PAS de contraintes HTML/mail (table, doctype…)", () => {
    const p = buildWhatsAppAiPrompt({ description: "x" });
    expect(p.toLowerCase()).not.toContain("<!doctype");
    expect(p.toLowerCase()).not.toContain("<table>");
    expect(p.toLowerCase()).not.toContain("styles inline");
  });
});
