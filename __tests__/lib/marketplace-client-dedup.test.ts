import { describe, it, expect } from "vitest";
import {
  isSyntheticMarketplaceEmail,
  normalizeEmailForDedup,
} from "@/lib/marketplace-client-dedup";

describe("marketplace-client-dedup", () => {
  describe("normalizeEmailForDedup", () => {
    it("trim + lowercase", () => {
      expect(normalizeEmailForDedup("  Alice@BJ.com  ")).toBe("alice@bj.com");
    });
    it("null/vide/pas de @ → null", () => {
      expect(normalizeEmailForDedup(null)).toBeNull();
      expect(normalizeEmailForDedup("")).toBeNull();
      expect(normalizeEmailForDedup("no-at")).toBeNull();
    });
  });

  describe("isSyntheticMarketplaceEmail", () => {
    it("Microstore fallback → true", () => {
      expect(isSyntheticMarketplaceEmail("microstore-42@no-email.local")).toBe(true);
    });
    it("Ankorstore relay `orders+xxx` → true", () => {
      expect(isSyntheticMarketplaceEmail("orders+abc123@ankorstore.com")).toBe(true);
    });
    it("noreply / no-reply → true", () => {
      expect(isSyntheticMarketplaceEmail("noreply@shopify.com")).toBe(true);
      expect(isSyntheticMarketplaceEmail("no-reply@faire.com")).toBe(true);
    });
    it("email humain classique → false", () => {
      expect(isSyntheticMarketplaceEmail("alice@bj.com")).toBe(false);
      expect(isSyntheticMarketplaceEmail("boris@issyma.fr")).toBe(false);
    });
    it("email personnel chez ankorstore.com (rare mais possible) → false", () => {
      expect(isSyntheticMarketplaceEmail("staff@ankorstore.com")).toBe(false);
    });
  });
});
