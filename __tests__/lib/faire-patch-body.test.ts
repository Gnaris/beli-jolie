import { describe, it, expect } from "vitest";
import { buildPatchBody } from "@/lib/faire-update";
import type { FaireSyncDiff } from "@/lib/faire-sync-diff";

const emptyDiff: FaireSyncDiff = {
  productChanged: false,
  variantsChanged: [],
  variantsAdded: [],
  variantsRemoved: [],
  inventoryOnlyChanged: [],
  pricesOnlyChanged: [],
  lifecycleChanged: false,
};

const fullBody = {
  name: "Bague test",
  description: "desc",
  lifecycle_state: "PUBLISHED",
  taxonomy_type: { id: "tt_123" },
  variant_option_sets: [{ name: "Color", values: ["Argent"] }],
};

describe("buildPatchBody — lifecycle robustness", () => {
  it("inclut lifecycle_state quand productChanged est vrai (même si diff lifecycleChanged=false)", () => {
    const diff = { ...emptyDiff, productChanged: true };
    const out = buildPatchBody(diff, fullBody, false, false);
    expect(out.lifecycle_state).toBe("PUBLISHED");
    expect(out.name).toBe("Bague test");
  });

  it("inclut lifecycle_state quand de nouvelles variantes sont ajoutées", () => {
    const out = buildPatchBody(emptyDiff, fullBody, false, true);
    expect(out.lifecycle_state).toBe("PUBLISHED");
  });

  it("ne met JAMAIS variants[] dans le PATCH produit (utilisation POST dédié)", () => {
    const out = buildPatchBody(
      { ...emptyDiff, productChanged: true },
      fullBody,
      false,
      true,
    );
    expect(out.variants).toBeUndefined();
    expect(out.variant_option_sets).toBeUndefined();
  });

  it("n'inclut PAS lifecycle_state quand aucun PATCH n'est nécessaire", () => {
    const out = buildPatchBody(emptyDiff, fullBody, false, false);
    expect(out.lifecycle_state).toBeUndefined();
    expect(Object.keys(out)).toHaveLength(0);
  });

  it("inclut lifecycle_state quand lifecycleChanged est vrai (cas nominal)", () => {
    const diff = { ...emptyDiff, lifecycleChanged: true };
    const out = buildPatchBody(diff, { ...fullBody, lifecycle_state: "UNPUBLISHED" }, false, false);
    expect(out.lifecycle_state).toBe("UNPUBLISHED");
  });

  it("court-circuit pricesOnly retourne un body vide (pas de PATCH produit)", () => {
    const diff = { ...emptyDiff, pricesOnlyChanged: ["sku1"] };
    const out = buildPatchBody(diff, fullBody, true, false);
    expect(out).toEqual({});
  });
});
