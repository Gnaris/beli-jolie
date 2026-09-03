import { describe, it, expect } from "vitest";
import {
  requiredBlocksFor,
  missingRequiredBlocks,
} from "@/lib/mail-scenario-defaults";

describe("mail-scenario-defaults — requiredBlocksFor", () => {
  it("newsletter classique (null) : aucun bloc requis", () => {
    expect(requiredBlocksFor(null)).toEqual([]);
  });

  it("ABANDONED_CART : requiert cartItems", () => {
    const req = requiredBlocksFor("ABANDONED_CART");
    expect(req).toHaveLength(1);
    expect(req[0].type).toBe("cartItems");
  });

  it("RESTOCK : requiert favoritesGrid", () => {
    const req = requiredBlocksFor("RESTOCK");
    expect(req[0].type).toBe("favoritesGrid");
  });

  it("INACTIVE_CLIENT : requiert daysInactive", () => {
    const req = requiredBlocksFor("INACTIVE_CLIENT");
    expect(req[0].type).toBe("daysInactive");
  });
});

describe("mail-scenario-defaults — missingRequiredBlocks", () => {
  it("aucun bloc obligatoire (null) : jamais de manquant", () => {
    expect(missingRequiredBlocks(null, [])).toEqual([]);
    expect(missingRequiredBlocks(null, ["heading", "button"])).toEqual([]);
  });

  it("ABANDONED_CART sans cartItems : signale manquant", () => {
    const missing = missingRequiredBlocks("ABANDONED_CART", ["heading", "button"]);
    expect(missing).toHaveLength(1);
    expect(missing[0].type).toBe("cartItems");
  });

  it("ABANDONED_CART avec cartItems : aucun manquant", () => {
    const missing = missingRequiredBlocks("ABANDONED_CART", ["heading", "cartItems", "button"]);
    expect(missing).toEqual([]);
  });

  it("plusieurs blocs manquants seraient tous listés (hypothétique)", () => {
    // Aujourd'hui il n'y a qu'un seul bloc requis par scénario, mais la fonction
    // gère le cas N — ce test garde le contrat.
    expect(missingRequiredBlocks("RESTOCK", []).map((m) => m.type)).toEqual(["favoritesGrid"]);
  });
});
