/**
 * Tests unitaires du helper buildMarketplaceInputs — s'assure que Microstore
 * est bien traité comme les 5 autres marketplaces depuis la refonte 2026-08-25
 * (auparavant Microstore était hors queue avec appel direct + toast).
 */
import { describe, it, expect } from "vitest";
import {
  allCandidateIds,
  buildMarketplaceInputs,
  hasAnyCandidate,
  type MarketplaceCandidates,
} from "@/lib/marketplace-propagation";

const p = (id: string) => ({ id, reference: id, name: `Produit ${id}`, firstImage: null });

const emptyCandidates: MarketplaceCandidates = {
  pfs: [],
  ankorstore: [],
  efashion: [],
  faire: [],
  orderchamp: [],
  microstore: [],
};

describe("hasAnyCandidate — inclut Microstore", () => {
  it("false si tout est vide", () => {
    expect(hasAnyCandidate(emptyCandidates)).toBe(false);
  });
  it("true si uniquement des candidats Microstore", () => {
    expect(hasAnyCandidate({ ...emptyCandidates, microstore: [p("A")] })).toBe(true);
  });
});

describe("allCandidateIds — dédoublonne y compris Microstore", () => {
  it("union unique de toutes les listes", () => {
    const ids = allCandidateIds({
      ...emptyCandidates,
      pfs: [p("A"), p("B")],
      microstore: [p("A"), p("C")],
    });
    expect(ids.sort()).toEqual(["A", "B", "C"]);
  });
});

describe("buildMarketplaceInputs — produit un job Microstore par candidat coché", () => {
  it("aucun input si options.microstore = false", () => {
    const inputs = buildMarketplaceInputs(
      { ...emptyCandidates, microstore: [p("A")] },
      { microstore: false },
    );
    expect(inputs).toEqual([]);
  });

  it("un input microstore par produit quand la case est cochée", () => {
    const inputs = buildMarketplaceInputs(
      { ...emptyCandidates, microstore: [p("A"), p("B")] },
      { microstore: true },
    );
    expect(inputs).toHaveLength(2);
    for (const inp of inputs) {
      expect(inp.marketplace).toBe("microstore");
      expect(inp.mode).toBe("publish");
      expect(inp.options.microstore).toBe(true);
      expect(inp.options.local).toBe(false);
    }
    expect(inputs.map((i) => i.productId).sort()).toEqual(["A", "B"]);
  });

  it("mode custom appliqué à Microstore aussi", () => {
    const inputs = buildMarketplaceInputs(
      { ...emptyCandidates, microstore: [p("A")] },
      { microstore: true },
      "resync",
    );
    expect(inputs[0]?.mode).toBe("resync");
  });

  it("mixe PFS et Microstore dans un même lot", () => {
    const inputs = buildMarketplaceInputs(
      {
        ...emptyCandidates,
        pfs: [p("A")],
        microstore: [p("B")],
      },
      { pfs: true, microstore: true },
    );
    const marketplaces = inputs.map((i) => i.marketplace).sort();
    expect(marketplaces).toEqual(["microstore", "pfs"]);
  });
});
