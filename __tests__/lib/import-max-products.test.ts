import { describe, it, expect } from "vitest";

/**
 * Test that maxProducts limit logic works correctly.
 * We test the pure logic (Map truncation) since the actual functions
 * depend on Prisma/DB.
 */
describe("maxProducts limit logic", () => {
  function applyMaxProducts(grouped: Map<string, unknown[]>, maxProducts?: number) {
    if (maxProducts && maxProducts > 0 && grouped.size > maxProducts) {
      const keys = [...grouped.keys()];
      for (let k = maxProducts; k < keys.length; k++) {
        grouped.delete(keys[k]);
      }
    }
    return grouped;
  }

  it("should keep all products when maxProducts is undefined", () => {
    const grouped = new Map([
      ["REF-001", [{ name: "A" }]],
      ["REF-002", [{ name: "B" }]],
      ["REF-003", [{ name: "C" }]],
    ]);
    applyMaxProducts(grouped, undefined);
    expect(grouped.size).toBe(3);
  });

  it("should keep all products when maxProducts is 0", () => {
    const grouped = new Map([
      ["REF-001", [{ name: "A" }]],
      ["REF-002", [{ name: "B" }]],
    ]);
    applyMaxProducts(grouped, 0);
    expect(grouped.size).toBe(2);
  });

  it("should limit to maxProducts when specified", () => {
    const grouped = new Map([
      ["REF-001", [{ name: "A" }]],
      ["REF-002", [{ name: "B" }]],
      ["REF-003", [{ name: "C" }]],
      ["REF-004", [{ name: "D" }]],
      ["REF-005", [{ name: "E" }]],
    ]);
    applyMaxProducts(grouped, 2);
    expect(grouped.size).toBe(2);
    expect(grouped.has("REF-001")).toBe(true);
    expect(grouped.has("REF-002")).toBe(true);
    expect(grouped.has("REF-003")).toBe(false);
  });

  it("should keep all when maxProducts >= grouped size", () => {
    const grouped = new Map([
      ["REF-001", [{ name: "A" }]],
      ["REF-002", [{ name: "B" }]],
    ]);
    applyMaxProducts(grouped, 10);
    expect(grouped.size).toBe(2);
  });

  it("should work with maxProducts = 1", () => {
    const grouped = new Map([
      ["REF-001", [{ name: "A" }, { name: "A2" }]],
      ["REF-002", [{ name: "B" }]],
      ["REF-003", [{ name: "C" }]],
    ]);
    applyMaxProducts(grouped, 1);
    expect(grouped.size).toBe(1);
    expect(grouped.has("REF-001")).toBe(true);
    // Should keep all variants of the first product
    expect(grouped.get("REF-001")!.length).toBe(2);
  });

  // Test the preview entries.slice logic
  it("preview: entries.slice should limit correctly", () => {
    const grouped = new Map([
      ["REF-001", [{}]],
      ["REF-002", [{}]],
      ["REF-003", [{}]],
      ["REF-004", [{}]],
      ["REF-005", [{}]],
    ]);
    const maxProducts = 3;
    let entries = [...grouped.entries()];
    const totalBeforeLimit = entries.length;
    if (maxProducts > 0 && entries.length > maxProducts) {
      entries = entries.slice(0, maxProducts);
    }
    expect(entries.length).toBe(3);
    expect(totalBeforeLimit).toBe(5);
  });

  // Test parseInt behavior with edge cases
  it("parseInt edge cases for maxProducts input", () => {
    expect(parseInt("") > 0).toBe(false); // NaN > 0 = false
    expect(parseInt("10") > 0).toBe(true);
    expect(parseInt("0") > 0).toBe(false);
    expect(parseInt("-5") > 0).toBe(false);
    expect(parseInt("abc") > 0).toBe(false); // NaN
  });
});
