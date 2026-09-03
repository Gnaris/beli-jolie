import { describe, it, expect } from "vitest";
import {
  missingRequiredMarketingVariables,
  REQUIRED_MARKETING_VARIABLES,
} from "@/lib/mail-merge-variables";
import { collectBlocksText, renderNewsletterHtml, type NewsletterBlock, type ProductLite } from "@/lib/newsletter-blocks";
import type { SharedMailContext } from "@/lib/mail-templates/shared";

const shared: SharedMailContext = {
  shopName: "Beli & Jolie",
  baseUrl: "https://beliandjolie.com",
  legalLine: "Beli & Jolie · Aubervilliers",
};

describe("REQUIRED_MARKETING_VARIABLES", () => {
  it("contient exactement les 4 mentions légales obligatoires", () => {
    const tokens = REQUIRED_MARKETING_VARIABLES.map((v) => v.token).sort();
    expect(tokens).toEqual(["privacyLink", "shopAddress", "shopName", "unsubscribeLink"]);
  });
});

describe("missingRequiredMarketingVariables", () => {
  it("retourne toutes les variables si le contenu est vide", () => {
    const missing = missingRequiredMarketingVariables("");
    expect(missing.length).toBe(4);
  });

  it("retourne vide si les 4 tokens sont présents", () => {
    const content = "Hello {shopName} at {shopAddress}. {unsubscribeLink} - {privacyLink}";
    const missing = missingRequiredMarketingVariables(content);
    expect(missing).toEqual([]);
  });

  it("ne détecte QUE les variables absentes", () => {
    const content = "Hello {shopName}. Unsubscribe: {unsubscribeLink}";
    const missing = missingRequiredMarketingVariables(content);
    const tokens = missing.map((v) => v.token).sort();
    expect(tokens).toEqual(["privacyLink", "shopAddress"]);
  });
});

describe("collectBlocksText", () => {
  it("agrège le texte des blocs heading, list, button, columns", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h", type: "heading", data: { title: "Bonjour {firstName}", body: "corps", align: "left" } },
      { id: "l", type: "list", data: { items: ["Item {shopName}", "Item 2"] } },
      { id: "b", type: "button", data: { label: "Voir {privacyLink}", url: "https://x.com", bg: "#000", color: "#fff", align: "center" } },
    ];
    const text = collectBlocksText(blocks);
    expect(text).toContain("Bonjour {firstName}");
    expect(text).toContain("Item {shopName}");
    expect(text).toContain("{privacyLink}");
  });

  it("ignore les blocs sans texte (banner, divider, empty)", () => {
    const blocks: NewsletterBlock[] = [
      { id: "b", type: "banner", data: { img: "/x.webp", alt: "" } },
      { id: "d", type: "divider", data: {} },
      { id: "e", type: "empty", data: { height: 20 } },
    ];
    const text = collectBlocksText(blocks);
    expect(text).toBe("");
  });
});

describe("renderNewsletterHtml — omitGlobalChrome", () => {
  it("false (défaut) : inclut header (Sujet du mail) + footer (nom boutique)", () => {
    const html = renderNewsletterHtml({
      subject: "Test subject",
      blocks: [],
      productsById: new Map<string, ProductLite>(),
      shared,
    });
    // Le titre du mail figure dans le <h1> du header global
    expect(html).toMatch(/<h1[^>]*>[^<]*Test subject/);
    // Le footer global contient l'accessible nom boutique
    expect(html).toContain("Beli &amp; Jolie");
  });

  it("true : ne rend NI header NI footer globaux", () => {
    const html = renderNewsletterHtml({
      subject: "Test subject",
      blocks: [
        { id: "h", type: "heading", data: { title: "Bonjour", body: "corps", align: "left" } },
      ],
      productsById: new Map<string, ProductLite>(),
      shared,
      omitGlobalChrome: true,
    });
    // Pas de bannière avec le sujet en H1
    expect(html).not.toMatch(/<h1[^>]*>[^<]*Test subject/);
    // Le corps est bien présent
    expect(html).toContain("Bonjour");
    // Pas de section footer avec la ligne légale
    expect(html).not.toContain("Beli &amp; Jolie · Aubervilliers");
  });
});
