import { describe, it, expect } from "vitest";
import { computeShowStockBadges } from "@/components/admin/products/AdminProductsTable";

describe("computeShowStockBadges — brouillon/rupture rule", () => {
  it("hides both badges for incomplete drafts (isIncomplete=true)", () => {
    expect(computeShowStockBadges({ status: "OFFLINE", isIncomplete: true }, "rupture")).toBe(false);
    expect(computeShowStockBadges({ status: "OFFLINE", isIncomplete: true }, "partial")).toBe(false);
    // Even ONLINE: if isIncomplete (edge case), still hide badges
    expect(computeShowStockBadges({ status: "ONLINE", isIncomplete: true }, "rupture")).toBe(false);
    expect(computeShowStockBadges({ status: "ONLINE", isIncomplete: true }, "partial")).toBe(false);
  });

  it("hides both badges for OFFLINE products (status-only draft)", () => {
    expect(computeShowStockBadges({ status: "OFFLINE", isIncomplete: false }, "rupture")).toBe(false);
    expect(computeShowStockBadges({ status: "OFFLINE", isIncomplete: false }, "partial")).toBe(false);
  });

  it("shows Rupture but hides Stock partiel for ARCHIVED products", () => {
    expect(computeShowStockBadges({ status: "ARCHIVED", isIncomplete: false }, "rupture")).toBe(true);
    expect(computeShowStockBadges({ status: "ARCHIVED", isIncomplete: false }, "partial")).toBe(false);
  });

  it("shows both badges for ONLINE complete products", () => {
    expect(computeShowStockBadges({ status: "ONLINE", isIncomplete: false }, "rupture")).toBe(true);
    expect(computeShowStockBadges({ status: "ONLINE", isIncomplete: false }, "partial")).toBe(true);
  });

  it("shows both badges for SYNCING products (transient, stock is real)", () => {
    expect(computeShowStockBadges({ status: "SYNCING", isIncomplete: false }, "rupture")).toBe(true);
    expect(computeShowStockBadges({ status: "SYNCING", isIncomplete: false }, "partial")).toBe(true);
  });
});
