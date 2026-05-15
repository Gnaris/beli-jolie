import { describe, it, expect } from "vitest";
import { computeRowActionEligibility } from "@/components/admin/products/AdminProductsTable";

const baseProduct = {
  status: "OFFLINE" as string,
  isIncomplete: false,
  pfsProductId: null as string | null,
  ankorsProductId: null as string | null,
};

const fullCtx = {
  hasPfsConfig: true,
  hasAnkorstoreConfig: true,
  ankorstoreEnabled: true,
};

describe("computeRowActionEligibility — actions du menu par ligne", () => {
  describe("canPutOnline", () => {
    it("autorise la mise en ligne d'un produit OFFLINE complet", () => {
      const e = computeRowActionEligibility(baseProduct, fullCtx);
      expect(e.canPutOnline).toBe(true);
      expect(e.putOnlineReason).toBeUndefined();
    });

    it("interdit si déjà ONLINE", () => {
      const e = computeRowActionEligibility({ ...baseProduct, status: "ONLINE" }, fullCtx);
      expect(e.canPutOnline).toBe(false);
      expect(e.putOnlineReason).toBe("Déjà en ligne");
    });

    it("interdit si le produit est incomplet (image obligatoire manquante)", () => {
      const e = computeRowActionEligibility({ ...baseProduct, isIncomplete: true }, fullCtx);
      expect(e.canPutOnline).toBe(false);
      expect(e.putOnlineReason).toContain("incomplet");
    });

    it("autorise depuis ARCHIVED (l'admin peut remettre en ligne un produit archivé)", () => {
      const e = computeRowActionEligibility({ ...baseProduct, status: "ARCHIVED" }, fullCtx);
      expect(e.canPutOnline).toBe(true);
    });
  });

  describe("canPutOffline", () => {
    it("autorise depuis ONLINE", () => {
      expect(computeRowActionEligibility({ ...baseProduct, status: "ONLINE" }, fullCtx).canPutOffline).toBe(true);
    });

    it("autorise depuis ARCHIVED", () => {
      expect(computeRowActionEligibility({ ...baseProduct, status: "ARCHIVED" }, fullCtx).canPutOffline).toBe(true);
    });

    it("interdit si déjà OFFLINE", () => {
      expect(computeRowActionEligibility({ ...baseProduct, status: "OFFLINE" }, fullCtx).canPutOffline).toBe(false);
    });
  });

  describe("canArchive", () => {
    it("autorise depuis ONLINE ou OFFLINE", () => {
      expect(computeRowActionEligibility({ ...baseProduct, status: "ONLINE" }, fullCtx).canArchive).toBe(true);
      expect(computeRowActionEligibility({ ...baseProduct, status: "OFFLINE" }, fullCtx).canArchive).toBe(true);
    });

    it("interdit si déjà ARCHIVED", () => {
      expect(computeRowActionEligibility({ ...baseProduct, status: "ARCHIVED" }, fullCtx).canArchive).toBe(false);
    });
  });

  describe("canSync", () => {
    it("false si publié sur rien", () => {
      const e = computeRowActionEligibility(baseProduct, fullCtx);
      expect(e.canSync).toBe(false);
    });

    it("true si publié sur PFS seulement", () => {
      const e = computeRowActionEligibility({ ...baseProduct, pfsProductId: "PFS-123" }, fullCtx);
      expect(e.canSync).toBe(true);
    });

    it("true si publié sur Ankorstore seulement", () => {
      const e = computeRowActionEligibility({ ...baseProduct, ankorsProductId: "ANK-456" }, fullCtx);
      expect(e.canSync).toBe(true);
    });

    it("false si publié sur PFS mais PFS non configuré côté serveur", () => {
      const e = computeRowActionEligibility(
        { ...baseProduct, pfsProductId: "PFS-123" },
        { ...fullCtx, hasPfsConfig: false },
      );
      expect(e.canSync).toBe(false);
    });

    it("false si Ankorstore configuré mais kill-switch OFF", () => {
      const e = computeRowActionEligibility(
        { ...baseProduct, ankorsProductId: "ANK-456" },
        { ...fullCtx, ankorstoreEnabled: false },
      );
      expect(e.canSync).toBe(false);
    });

    it("false si Ankorstore pas configuré (clé absente)", () => {
      const e = computeRowActionEligibility(
        { ...baseProduct, ankorsProductId: "ANK-456" },
        { ...fullCtx, hasAnkorstoreConfig: false },
      );
      expect(e.canSync).toBe(false);
    });

    it("true si publié sur Ankorstore désactivé mais aussi sur PFS actif", () => {
      const e = computeRowActionEligibility(
        { ...baseProduct, pfsProductId: "PFS-123", ankorsProductId: "ANK-456" },
        { ...fullCtx, ankorstoreEnabled: false },
      );
      expect(e.canSync).toBe(true);
    });
  });
});
