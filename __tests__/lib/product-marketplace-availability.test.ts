import { describe, it, expect } from "vitest";
import { computeProductMarketplaceAvailability } from "@/lib/product-marketplace-availability";

describe("computeProductMarketplaceAvailability", () => {
  describe("création vierge (mode=create + pas de productId)", () => {
    it("force les 6 marketplaces comme « déjà liées » (initialData absent)", () => {
      const result = computeProductMarketplaceAvailability({
        mode: "create",
        productId: undefined,
        initialData: undefined,
      });
      expect(result).toEqual({
        isFreshCreation: true,
        alreadyOnPfs: true,
        alreadyOnAnkorstore: true,
        alreadyOnEfashion: true,
        alreadyOnFaire: true,
        alreadyOnOrderchamp: true,
        alreadyOnMicrostore: true,
      });
    });

    it("force les 6 marketplaces même si initialData vient d'un dupliquerDe", () => {
      const result = computeProductMarketplaceAvailability({
        mode: "create",
        productId: undefined,
        initialData: {
          pfsProductId: null,
          ankorsProductId: null,
          efashionReferenceBase: null,
          faireProductId: null,
          orderchampProductId: null,
          microstoreProductId: null,
        },
      });
      expect(result.isFreshCreation).toBe(true);
      expect(result.alreadyOnPfs).toBe(true);
      expect(result.alreadyOnMicrostore).toBe(true);
    });
  });

  describe("édition d'un produit existant (mode=edit + productId)", () => {
    it("ne propose que les marketplaces avec ID posé sur initialData", () => {
      const result = computeProductMarketplaceAvailability({
        mode: "edit",
        productId: "prod_123",
        initialData: {
          pfsProductId: "pfs_42",
          ankorsProductId: null,
          efashionReferenceBase: "EF-BASE",
          faireProductId: null,
          orderchampProductId: null,
          microstoreProductId: 987,
        },
      });
      expect(result).toEqual({
        isFreshCreation: false,
        alreadyOnPfs: true,
        alreadyOnAnkorstore: false,
        alreadyOnEfashion: true,
        alreadyOnFaire: false,
        alreadyOnOrderchamp: false,
        alreadyOnMicrostore: true,
      });
    });

    it("ne propose rien si aucun ID marketplace n'est posé", () => {
      const result = computeProductMarketplaceAvailability({
        mode: "edit",
        productId: "prod_456",
        initialData: {
          pfsProductId: null,
          ankorsProductId: null,
          efashionReferenceBase: null,
          faireProductId: null,
          orderchampProductId: null,
          microstoreProductId: null,
        },
      });
      expect(result.isFreshCreation).toBe(false);
      expect(result.alreadyOnPfs).toBe(false);
      expect(result.alreadyOnAnkorstore).toBe(false);
      expect(result.alreadyOnEfashion).toBe(false);
      expect(result.alreadyOnFaire).toBe(false);
      expect(result.alreadyOnOrderchamp).toBe(false);
      expect(result.alreadyOnMicrostore).toBe(false);
    });
  });

  describe("finalisation d'un draft (mode=create + productId défini)", () => {
    it("garde le comportement standard « seulement les liées » (pas de forçage)", () => {
      const result = computeProductMarketplaceAvailability({
        mode: "create",
        productId: "draft_789",
        initialData: {
          pfsProductId: null,
          ankorsProductId: "ank_abc",
          efashionReferenceBase: null,
          faireProductId: null,
          orderchampProductId: null,
          microstoreProductId: null,
        },
      });
      expect(result.isFreshCreation).toBe(false);
      expect(result.alreadyOnAnkorstore).toBe(true);
      expect(result.alreadyOnPfs).toBe(false);
      expect(result.alreadyOnEfashion).toBe(false);
      expect(result.alreadyOnFaire).toBe(false);
      expect(result.alreadyOnOrderchamp).toBe(false);
      expect(result.alreadyOnMicrostore).toBe(false);
    });
  });

  describe("microstoreProductId = 0 (garde-fou)", () => {
    it("est considéré comme lié (!= null) — même si en pratique Microstore n'émet jamais l'id 0", () => {
      const result = computeProductMarketplaceAvailability({
        mode: "edit",
        productId: "prod_zero",
        initialData: { microstoreProductId: 0 },
      });
      expect(result.alreadyOnMicrostore).toBe(true);
    });
  });
});
