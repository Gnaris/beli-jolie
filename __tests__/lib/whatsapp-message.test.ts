/**
 * Tests des helpers de rendu de modèles WhatsApp.
 *
 * On teste :
 * - Le rendu des variables (mêmes tokens que les mails : firstName, company,
 *   shopName, adminFirstName…)
 * - Le comportement quand une variable est absente : le token est CONSERVÉ
 *   tel quel (voir `interpolate` dans mail-merge-variables) — c'est un
 *   safeguard visuel pour la cliente qui repérera `{firstName}` non substitué
 *   à la relecture avant envoi
 * - La construction d'URL WhatsApp (encodage des caractères spéciaux)
 * - Que WHATSAPP_VARIABLES exclut bien les groupes dynamique et legal
 */

import { describe, it, expect } from "vitest";

import {
  renderWhatsAppMessage,
  buildWhatsAppUrl,
  buildWhatsAppPreviewContext,
  WHATSAPP_VARIABLES,
} from "@/lib/whatsapp-message";

describe("renderWhatsAppMessage", () => {
  it("remplace les variables client + boutique + admin", () => {
    const out = renderWhatsAppMessage(
      "Bonjour {firstName} de {company}, c'est {adminFirstName} de {shopName}.",
      {
        firstName: "Marie",
        company: "Boutique Élégance",
        adminFirstName: "Boris",
        shopName: "Beli & Jolie",
      },
    );
    expect(out).toBe("Bonjour Marie de Boutique Élégance, c'est Boris de Beli & Jolie.");
  });

  it("conserve un token inconnu tel quel (safeguard visuel)", () => {
    const out = renderWhatsAppMessage("Salut {firstName}, votre {typoVar}", {
      firstName: "Léa",
    });
    expect(out).toBe("Salut Léa, votre {typoVar}");
  });

  it("gère un modèle sans variable", () => {
    const out = renderWhatsAppMessage("Bonjour ! Vous allez bien ?", {});
    expect(out).toBe("Bonjour ! Vous allez bien ?");
  });

  it("remplace plusieurs occurrences de la même variable", () => {
    const out = renderWhatsAppMessage("{firstName}, salut {firstName} !", {
      firstName: "Anna",
    });
    expect(out).toBe("Anna, salut Anna !");
  });

  it("gère un modèle vide", () => {
    expect(renderWhatsAppMessage("", {})).toBe("");
  });
});

describe("buildWhatsAppUrl", () => {
  it("construit l'URL de base sans message", () => {
    expect(buildWhatsAppUrl("33612345678")).toBe("https://wa.me/33612345678");
  });

  it("ignore un message vide ou blanc", () => {
    expect(buildWhatsAppUrl("33612345678", "")).toBe("https://wa.me/33612345678");
    expect(buildWhatsAppUrl("33612345678", "   ")).toBe("https://wa.me/33612345678");
  });

  it("ajoute le message rendu en URL-encoded", () => {
    expect(buildWhatsAppUrl("33612345678", "Bonjour Marie")).toBe(
      "https://wa.me/33612345678?text=Bonjour%20Marie",
    );
  });

  it("échappe les caractères spéciaux (accents, &, apostrophes)", () => {
    const url = buildWhatsAppUrl("33612345678", "Bonjour à toi & bienvenue");
    expect(url).toBe("https://wa.me/33612345678?text=Bonjour%20%C3%A0%20toi%20%26%20bienvenue");
  });
});

describe("WHATSAPP_VARIABLES", () => {
  it("inclut les 15 variables client de mail-merge-variables", () => {
    const clientTokens = WHATSAPP_VARIABLES.filter((v) => v.group === "client").map((v) => v.token);
    expect(clientTokens).toContain("firstName");
    expect(clientTokens).toContain("company");
    expect(clientTokens).toContain("orderCount");
    expect(clientTokens).toContain("totalSpent");
    expect(clientTokens).toContain("lastOrderDate");
  });

  it("inclut adminFirstName et adminLastName spécifiques WhatsApp", () => {
    const tokens = WHATSAPP_VARIABLES.map((v) => v.token);
    expect(tokens).toContain("adminFirstName");
    expect(tokens).toContain("adminLastName");
  });

  it("exclut les variables dynamiques scénarios (cartTotal, days, favoritesCount)", () => {
    const tokens = WHATSAPP_VARIABLES.map((v) => v.token);
    expect(tokens).not.toContain("cartTotal");
    expect(tokens).not.toContain("days");
    expect(tokens).not.toContain("favoritesCount");
  });

  it("exclut les variables legal (unsubscribeLink, privacyLink)", () => {
    const tokens = WHATSAPP_VARIABLES.map((v) => v.token);
    expect(tokens).not.toContain("unsubscribeLink");
    expect(tokens).not.toContain("privacyLink");
  });
});

describe("buildWhatsAppPreviewContext", () => {
  it("expose les previewValue de chaque variable", () => {
    const ctx = buildWhatsAppPreviewContext();
    expect(ctx.firstName).toBe("Marie");
    expect(ctx.adminFirstName).toBe("Boris");
    expect(ctx.shopName).toBe("Beli & Jolie");
  });

  it("les overrides tenant (shopName) priment sur le preview par défaut", () => {
    const ctx = buildWhatsAppPreviewContext({ shopName: "FORCYMA" });
    expect(ctx.shopName).toBe("FORCYMA");
    expect(ctx.firstName).toBe("Marie"); // Client fictif inchangé
  });

  it("ignore les overrides vides ou blancs", () => {
    const ctx = buildWhatsAppPreviewContext({ shopName: "  " });
    expect(ctx.shopName).toBe("Beli & Jolie");
  });
});
