import { describe, it, expect } from "vitest";
import { computeMarketplaceSyncFlags } from "@/lib/marketplace-sync-flag";

describe("computeMarketplaceSyncFlags", () => {
  it("renvoie un objet vide si aucun ID marketplace", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: null,
        ankorsProductId: null,
        efashionReferenceBase: null,
        faireProductId: null,
      }),
    ).toEqual({});
  });

  it("ne pose le drapeau PFS que si pfsProductId existe", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: "abc",
        ankorsProductId: null,
        efashionReferenceBase: null,
        faireProductId: null,
      }),
    ).toEqual({ pfsSyncRequired: true });
  });

  it("pose tous les drapeaux quand les 4 IDs existent", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: "p1",
        ankorsProductId: "a1",
        efashionReferenceBase: "e1",
        faireProductId: "f1",
      }),
    ).toEqual({
      pfsSyncRequired: true,
      ankorsSyncRequired: true,
      efashionSyncRequired: true,
      faireSyncRequired: true,
    });
  });

  it("ne pose le drapeau Faire que si faireProductId existe", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: null,
        ankorsProductId: null,
        efashionReferenceBase: null,
        faireProductId: "p_xyz",
      }),
    ).toEqual({ faireSyncRequired: true });
  });

  it("ignore les chaînes vides", () => {
    expect(
      computeMarketplaceSyncFlags({
        pfsProductId: "",
        ankorsProductId: "a1",
        efashionReferenceBase: "  ",
        faireProductId: "",
      }),
    ).toEqual({ ankorsSyncRequired: true });
  });
});
