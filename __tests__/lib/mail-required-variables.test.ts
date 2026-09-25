import { describe, it, expect } from "vitest";
import {
  missingRequiredMarketingVariables,
  missingScenarioTokens,
  REQUIRED_MARKETING_VARIABLES,
} from "@/lib/mail-merge-variables";
import {
  collectBlocksText,
  defaultDataFor,
  getFooterContent,
  renderNewsletterHtml,
  type FooterData,
  type HeaderData,
  type NewsletterBlock,
  type ProductLite,
} from "@/lib/newsletter-blocks";
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

describe("defaultDataFor(\"footer\")", () => {
  it("contient les 4 variables obligatoires — la sauvegarde passe dès l'ajout du bloc", () => {
    const data = defaultDataFor("footer") as FooterData;
    const missing = missingRequiredMarketingVariables(data.content);
    expect(missing).toEqual([]);
  });
});

describe("getFooterContent", () => {
  it("retourne null si aucun bloc footer n'est présent", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h", type: "heading", data: { title: "T", body: "B", align: "left" } },
    ];
    expect(getFooterContent(blocks)).toBeNull();
  });

  it("retourne le contenu du 1er bloc footer trouvé", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h", type: "heading", data: { title: "T", body: "B", align: "left" } },
      { id: "f", type: "footer", data: { content: "Mentions légales ici" } as FooterData },
    ];
    expect(getFooterContent(blocks)).toBe("Mentions légales ici");
  });

  it("retourne \"\" (chaîne vide) si le bloc footer existe mais data.content absent (rétrocompat)", () => {
    const blocks = [
      { id: "f", type: "footer", data: {} as unknown as FooterData },
    ] as NewsletterBlock[];
    expect(getFooterContent(blocks)).toBe("");
  });
});

describe("Validation « variables obligatoires DANS le footer »", () => {
  const legalContent = "{shopName} · {shopAddress}\n{unsubscribeLink} — {privacyLink}";

  it("les 4 tokens DANS le footer → validation OK", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h", type: "heading", data: { title: "Coucou", body: "corps", align: "left" } },
      { id: "f", type: "footer", data: { content: legalContent } as FooterData },
    ];
    const footer = getFooterContent(blocks);
    expect(footer).not.toBeNull();
    expect(missingRequiredMarketingVariables(footer ?? "")).toEqual([]);
  });

  it("les 4 tokens HORS du footer (dans un heading) → validation KO — les variables doivent être dans le footer", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h", type: "heading", data: { title: legalContent, body: "", align: "left" } },
      { id: "f", type: "footer", data: { content: "Pas de mentions" } as FooterData },
    ];
    const footer = getFooterContent(blocks);
    expect(footer).toBe("Pas de mentions");
    expect(missingRequiredMarketingVariables(footer ?? "").length).toBe(4);
  });

  it("pas de bloc footer du tout → getFooterContent null (message d'erreur spécifique côté server action)", () => {
    const blocks: NewsletterBlock[] = [
      { id: "h", type: "heading", data: { title: legalContent, body: "", align: "left" } },
    ];
    expect(getFooterContent(blocks)).toBeNull();
  });
});

describe("collectBlocksText (header + footer)", () => {
  it("inclut le titre et le sous-titre du bloc header", () => {
    const blocks: NewsletterBlock[] = [
      { id: "hd", type: "header", data: { title: "Bienvenue {firstName}", subtitle: "chez nous" } as HeaderData },
    ];
    const text = collectBlocksText(blocks);
    expect(text).toContain("Bienvenue {firstName}");
    expect(text).toContain("chez nous");
  });

  it("inclut le contenu du bloc footer", () => {
    const blocks: NewsletterBlock[] = [
      { id: "f", type: "footer", data: { content: "Mentions {shopName}" } as FooterData },
    ];
    expect(collectBlocksText(blocks)).toContain("Mentions {shopName}");
  });
});

describe("renderNewsletterHtml — nouveaux blocs header / footer", () => {
  it("rend le bloc footer dans le HTML final (n'est plus filtré par renderNewsletterHtml)", () => {
    const html = renderNewsletterHtml({
      subject: "S",
      blocks: [
        {
          id: "f",
          type: "footer",
          data: { content: "Pied de page perso", bg: "#f8fafc", color: "#64748b", align: "center", fontSize: 12 } as FooterData,
        },
      ],
      productsById: new Map<string, ProductLite>(),
      shared,
      omitGlobalChrome: true,
    });
    expect(html).toContain("Pied de page perso");
  });

  it("rend le bloc header avec logo, titre et sous-titre", () => {
    const html = renderNewsletterHtml({
      subject: "S",
      blocks: [
        {
          id: "hd",
          type: "header",
          data: {
            logo: "/uploads/logo.webp",
            logoMaxHeight: 60,
            title: "Belle boutique",
            subtitle: "Nouvelle collection",
            bg: "#0f172a",
            textColor: "#ffffff",
            titleSize: 22,
            subtitleSize: 13,
            align: "center",
          } as HeaderData,
        },
      ],
      productsById: new Map<string, ProductLite>(),
      shared,
      omitGlobalChrome: true,
    });
    expect(html).toContain("Belle boutique");
    expect(html).toContain("Nouvelle collection");
    expect(html).toContain("/uploads/logo.webp");
  });

  it("bloc header vide (aucun logo/titre/sous-titre) → n'ajoute rien au HTML", () => {
    const html = renderNewsletterHtml({
      subject: "S",
      blocks: [
        {
          id: "hd",
          type: "header",
          data: { logo: "", title: "", subtitle: "" } as HeaderData,
        },
      ],
      productsById: new Map<string, ProductLite>(),
      shared,
      omitGlobalChrome: true,
    });
    // Le corps du wrapMail ne doit pas contenir de <h1> issu du header
    expect(html).not.toMatch(/<h1[^>]*>Bienvenue/);
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

describe("missingScenarioTokens — plus de garde-fou (facultatif depuis 2026-09-25)", () => {
  it("scénario null → aucune contrainte", () => {
    expect(missingScenarioTokens("<p>Test</p>", null)).toEqual([]);
  });

  it("ABANDONED_CART sans la boucle produits → autorisé (facultatif)", () => {
    const html = `<p>Bonjour {firstName}, ton panier attend.</p>`;
    expect(missingScenarioTokens(html, "ABANDONED_CART")).toEqual([]);
  });

  it("INACTIVE_CLIENT sans {days} → autorisé (facultatif)", () => {
    expect(missingScenarioTokens("<p>Coucou !</p>", "INACTIVE_CLIENT")).toEqual([]);
  });

  it("RESTOCK sans la boucle favoris → autorisé (facultatif)", () => {
    expect(missingScenarioTokens("<p>Un article vient de revenir !</p>", "RESTOCK")).toEqual([]);
  });
});
