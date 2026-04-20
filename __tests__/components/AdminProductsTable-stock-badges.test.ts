import { describe, it, expect } from "vitest";
import { computeShowStockBadges } from "@/components/admin/products/AdminProductsTable";

describe("computeShowStockBadges — brouillon/rupture rule", () => {
  it("hides badges for incomplete drafts (isIncomplete=true)", () => {
    expect(computeShowStockBadges({ status: "OFFLINE", isIncomplete: true })).toBe(false);
    // Even ONLINE: if isIncomplete (edge case), still hide badges
    expect(computeShowStockBadges({ status: "ONLINE", isIncomplete: true })).toBe(false);
  });

  it("hides badges for OFFLINE products (status-only draft)", () => {
    expect(computeShowStockBadges({ status: "OFFLINE", isIncomplete: false })).toBe(false);
  });

  it("hides badges for ARCHIVED products", () => {
    expect(computeShowStockBadges({ status: "ARCHIVED", isIncomplete: false })).toBe(false);
  });

  it("shows badges for ONLINE complete products", () => {
    expect(computeShowStockBadges({ status: "ONLINE", isIncomplete: false })).toBe(true);
  });

  it("shows badges for SYNCING products (transient, stock is real)", () => {
    expect(computeShowStockBadges({ status: "SYNCING", isIncomplete: false })).toBe(true);
  });
});
