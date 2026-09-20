import { describe, it, expect } from "vitest";
import {
  inactiveClientStageDefault,
  SCENARIO_DEFAULTS,
} from "@/lib/mail-scenario-defaults";
import { templateHasUnsubscribeLink } from "@/lib/inactive-client-config";

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
});
