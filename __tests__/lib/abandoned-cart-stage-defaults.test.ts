import { describe, it, expect } from "vitest";
import {
  abandonedCartStageDefault,
  SCENARIO_DEFAULTS,
} from "@/lib/mail-scenario-defaults";
import { collectBlocksText } from "@/lib/newsletter-blocks";
import { templateHasUnsubscribeLink } from "@/lib/abandoned-cart-config";

/**
 * Ces tests figent le contrat des 3 designs par défaut : chaque stade doit
 * (1) contenir un bloc dynamique `cartItems`, (2) avoir un pied de page avec
 * les 4 variables légales, (3) personnaliser via `{firstName}`, (4) proposer
 * un sujet distinct des autres stades pour ne pas confondre en boîte mail.
 */
describe("abandonedCartStageDefault", () => {
  it("stade 1 = template officiel du scénario ABANDONED_CART", () => {
    const s1 = abandonedCartStageDefault(1);
    expect(s1.subject).toBe(SCENARIO_DEFAULTS.ABANDONED_CART.subject);
    expect(s1.blocks.length).toBe(SCENARIO_DEFAULTS.ABANDONED_CART.blocks.length);
  });

  it.each([1, 2, 3])("stade %i : contient un bloc cartItems", (idx) => {
    const def = abandonedCartStageDefault(idx);
    const types = def.blocks.map((b) => b.type);
    expect(types).toContain("cartItems");
  });

  it.each([1, 2, 3])(
    "stade %i : bloc footer avec les 4 variables légales",
    (idx) => {
      const def = abandonedCartStageDefault(idx);
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
    "stade %i : templateHasUnsubscribeLink() valide (activation possible)",
    (idx) => {
      const def = abandonedCartStageDefault(idx);
      expect(templateHasUnsubscribeLink(def.blocks)).toBe(true);
    },
  );

  it.each([1, 2, 3])(
    "stade %i : personnalise via {firstName} dans le corps",
    (idx) => {
      const def = abandonedCartStageDefault(idx);
      const text = collectBlocksText(def.blocks);
      expect(text).toContain("{firstName}");
    },
  );

  it("les 3 stades ont des sujets distincts (repérage en boîte mail)", () => {
    const s1 = abandonedCartStageDefault(1).subject;
    const s2 = abandonedCartStageDefault(2).subject;
    const s3 = abandonedCartStageDefault(3).subject;
    expect(new Set([s1, s2, s3]).size).toBe(3);
  });

  it("les 3 stades commencent par un header et finissent par un footer", () => {
    for (const idx of [1, 2, 3]) {
      const blocks = abandonedCartStageDefault(idx).blocks;
      expect(blocks[0].type, `stade ${idx}: 1er bloc = header`).toBe("header");
      expect(
        blocks[blocks.length - 1].type,
        `stade ${idx}: dernier bloc = footer`,
      ).toBe("footer");
    }
  });

  it("stade 3 : contient le bandeau « Stock limité » (heading dark)", () => {
    const s3 = abandonedCartStageDefault(3);
    const warn = s3.blocks.find(
      (b) =>
        b.type === "heading" &&
        "title" in b.data &&
        b.data.title.toUpperCase().includes("STOCK"),
    );
    expect(warn, "bandeau stock limité manquant").toBeDefined();
  });

  it("stade > 3 : retombe sur le design du stade 3 (fallback)", () => {
    const s4 = abandonedCartStageDefault(4);
    const s3 = abandonedCartStageDefault(3);
    expect(s4.subject).toBe(s3.subject);
  });
});
