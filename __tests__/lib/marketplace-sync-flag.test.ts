import { describe, it, expect } from "vitest";
import { computeMarketplaceSyncFlags } from "@/lib/marketplace-sync-flag";

describe("computeMarketplaceSyncFlags", () => {
  it("renvoie un objet vide si aucun ID marketplace", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: null,
        ankorsProductId: null,
        efashionReferenceBase: null,
      }),
    ).toEqual({});
  });

  it("ne pose le drapeau PFS que si pfsProductId existe", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: "abc",
        ankorsProductId: null,
        efashionReferenceBase: null,
      }),
    ).toEqual({ pfsSyncRequired: true });
  });

  it("pose tous les drapeaux quand les 3 IDs existent", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: "p1",
        ankorsProductId: "a1",
        efashionReferenceBase: "e1",
      }),
    ).toEqual({
      pfsSyncRequired: true,
      ankorsSyncRequired: true,
      efashionSyncRequired: true,
    });
  });

  it("ignore les chaînes vides", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: "",
        ankorsProductId: "a1",
        efashionReferenceBase: "  ",
      }),
    ).toEqual({ ankorsSyncRequired: true });
  });
});
