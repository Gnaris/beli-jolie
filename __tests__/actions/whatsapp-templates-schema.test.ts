/**
 * Tests unitaires du schéma Zod utilisé pour valider create/update d'un
 * modèle WhatsApp. Vérifie les 4 règles métier :
 *   - Titre obligatoire, ≤ 80 caractères
 *   - Body obligatoire, ≤ 1000 caractères
 *   - Trim automatique des espaces bordants
 *   - Message d'erreur explicite (utilisé dans le toast serveur)
 *
 * Le CRUD complet (avec Prisma + requireAdmin) est couvert par les tests
 * end-to-end manuels sur /admin/marketing/whatsapp — pas d'intégration
 * ici pour éviter de dépendre d'une session mockée.
 */

import { describe, it, expect } from "vitest";

import { whatsAppTemplateSchema } from "@/lib/whatsapp-template-schema";

describe("whatsAppTemplateSchema", () => {
  it("accepte un modèle valide", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "Bienvenue",
      body: "Bonjour {firstName}, bienvenue chez {shopName} !",
    });
    expect(res.success).toBe(true);
  });

  it("refuse un titre vide", () => {
    const res = whatsAppTemplateSchema.safeParse({ title: "", body: "Message" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain("titre");
    }
  });

  it("refuse un titre trop long (> 80)", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "a".repeat(81),
      body: "Message",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain("80");
    }
  });

  it("refuse un body vide", () => {
    const res = whatsAppTemplateSchema.safeParse({ title: "Titre", body: "" });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain("contenu");
    }
  });

  it("refuse un body trop long (> 1000)", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "Titre",
      body: "a".repeat(1001),
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain("1000");
    }
  });

  it("trim les espaces bordants du titre et du body", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "  Bienvenue  ",
      body: "  Bonjour  ",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.title).toBe("Bienvenue");
      expect(res.data.body).toBe("Bonjour");
    }
  });

  it("refuse un titre qui devient vide après trim", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "   ",
      body: "Message",
    });
    expect(res.success).toBe(false);
  });

  it("refuse un body qui contient un emoji 4-byte (👋)", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "Bienvenue",
      body: "Bonjour {firstName} 👋",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain("emoji");
    }
  });

  it("refuse un body qui contient un emoji BMP (✨)", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "Nouveautés",
      body: "Nouvelles pièces en ligne ✨",
    });
    expect(res.success).toBe(false);
  });

  it("refuse un emoji dans le titre", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "Bienvenue 👋",
      body: "Message propre",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain("emoji");
    }
  });

  it("accepte les caractères accentués et symboles courants", () => {
    const res = whatsAppTemplateSchema.safeParse({
      title: "Relance après visite",
      body: "Bonjour {firstName}, à bientôt chez FORCYMA — 12,50 € offert.",
    });
    expect(res.success).toBe(true);
  });
});
