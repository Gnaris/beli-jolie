import { describe, it, expect } from "vitest";
import {
  inactiveClientStageDefault,
  SCENARIO_DEFAULTS,
} from "@/lib/mail-scenario-defaults";
import { templateHasUnsubscribeLink } from "@/lib/inactive-client-config";
import {
  renderNewsletterHtml,
  substituteVariables,
  type NewsletterBlock,
} from "@/lib/newsletter-blocks";
import { interpolate } from "@/lib/mail-merge-variables";

/**
 * Fige le contrat des 3 designs par défaut de la relance inactivité :
 * (1) chaque stade doit contenir un bloc dynamique `daysInactive`,
 * (2) avoir un pied de page avec les 4 variables légales,
 * (3) personnaliser via `{firstName}`,
 * (4) proposer un sujet distinct des autres stades.
 */
describe("inactiveClientStageDefault", () => {
  it("stade 1 = template officiel du scénario INACTIVE_CLIENT", () => {
    const s1 = inactiveClientStageDefault(1);
    expect(s1.subject).toBe(SCENARIO_DEFAULTS.INACTIVE_CLIENT.subject);
    expect(s1.blocks.length).toBe(SCENARIO_DEFAULTS.INACTIVE_CLIENT.blocks.length);
  });

  it.each([1, 2, 3])("stade %i : contient un bloc daysInactive", (idx) => {
    const def = inactiveClientStageDefault(idx);
    const types = def.blocks.map((b) => b.type);
    expect(types).toContain("daysInactive");
  });

  it.each([1, 2, 3])(
    "stade %i : bloc footer avec les 4 variables légales",
    (idx) => {
      const def = inactiveClientStageDefault(idx);
      const footer = def.blocks.find((b) => b.type === "footer");
      expect(footer, "un bloc footer doit être présent").toBeDefined();
      const text = footer && "content" in footer.data ? footer.data.content : "";
      expect(text).toContain("{shopName}");
      expect(text).toContain("{shopAddress}");
      expect(text).toContain("{unsubscribeLink}");
      expect(text).toContain("{privacyLink}");
    },
  );

  it.each([1, 2, 3])(
    "stade %i : templateHasUnsubscribeLink === true (garde-fou activation)",
    (idx) => {
      expect(templateHasUnsubscribeLink(inactiveClientStageDefault(idx).blocks)).toBe(true);
    },
  );

  it("les 3 stades ont des sujets distincts (pas de doublon en boîte mail)", () => {
    const subjects = [1, 2, 3].map((i) => inactiveClientStageDefault(i).subject);
    expect(new Set(subjects).size).toBe(3);
  });

  it("stade > 3 retombe sur le design du stade 3", () => {
    const s3 = inactiveClientStageDefault(3);
    const s4 = inactiveClientStageDefault(4);
    expect(s4.subject).toBe(s3.subject);
  });

  it("les 3 stades commencent par un header (identité de scénario)", () => {
    for (const idx of [1, 2, 3]) {
      const def = inactiveClientStageDefault(idx);
      expect(def.blocks[0]?.type).toBe("header");
    }
  });

  it("chaque stade utilise une composition distincte (signature visuelle)", () => {
    // Fige la personnalité de chaque stade : features/callout+mailto/columns.
    const s1Types = inactiveClientStageDefault(1).blocks.map((b) => b.type);
    const s2Types = inactiveClientStageDefault(2).blocks.map((b) => b.type);
    const s3Types = inactiveClientStageDefault(3).blocks.map((b) => b.type);
    expect(s1Types).toContain("featuresRow");
    expect(s2Types).toContain("callout");
    expect(s3Types).toContain("columns");
  });

  it("stade 2 : le callout pointe vers mailto:{shopEmail}", () => {
    const s2 = inactiveClientStageDefault(2);
    const callout = s2.blocks.find((b) => b.type === "callout");
    expect(callout).toBeDefined();
    if (callout && callout.type === "callout") {
      expect(callout.data.ctaUrl).toBe("mailto:{shopEmail}");
    }
  });

  it.each([1, 2, 3])(
    "stade %i : le rendu HTML complet ne throw pas et interpole les variables",
    (idx) => {
      const def = inactiveClientStageDefault(idx);
      const context = {
        firstName: "Marie",
        shopName: "Boutique Test",
        shopEmail: "contact@example.com",
        shopAddress: "12 rue Test, 75000 Paris",
        unsubscribeLink: "https://example.com/unsub?t=abc",
        privacyLink: "https://example.com/confidentialite",
      };
      const finalBlocks = substituteVariables(
        def.blocks as NewsletterBlock[],
        context,
      );
      const finalSubject = interpolate(def.subject, context);
      const html = renderNewsletterHtml({
        subject: finalSubject,
        blocks: finalBlocks,
        productsById: new Map(),
        shared: {
          shopName: context.shopName,
          baseUrl: "https://example.com",
          legalLine: `${context.shopName} · ${context.shopAddress}`,
          mergeContext: context,
        },
        dynamic: { firstName: context.firstName, daysInactive: 42 },
        omitGlobalChrome: true,
      });
      expect(html).toContain("Boutique Test");
      expect(html).toContain("42");
      // Aucune variable non substituée dans le HTML final.
      expect(html).not.toContain("{firstName}");
      expect(html).not.toContain("{shopEmail}");
      expect(html).not.toContain("{shopName}");
      // Stade 2 : le mailto: doit être bien assemblé côté callout.
      if (idx === 2) {
        expect(html).toContain("mailto:contact@example.com");
      }
    },
  );
});
