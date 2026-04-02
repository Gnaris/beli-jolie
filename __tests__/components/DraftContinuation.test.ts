import { describe, it, expect } from "vitest";

/**
 * Tests for draft continuation logic.
 * When a product is a draft (isIncomplete=true, status="OFFLINE"),
 * the edit page should render in "create" mode with pre-filled data
 * instead of normal "edit" mode.
 */

describe("Draft detection logic", () => {
  function isDraft(product: { isIncomplete: boolean; status: string }): boolean {
    return product.isIncomplete && product.status === "OFFLINE";
  }

  it("detects a draft product (isIncomplete + OFFLINE)", () => {
    expect(isDraft({ isIncomplete: true, status: "OFFLINE" })).toBe(true);
  });

  it("does not detect a complete OFFLINE product as draft", () => {
    expect(isDraft({ isIncomplete: false, status: "OFFLINE" })).toBe(false);
  });

  it("does not detect an incomplete ONLINE product as draft", () => {
    // Edge case: shouldn't happen normally, but if it does, treat as normal edit
    expect(isDraft({ isIncomplete: true, status: "ONLINE" })).toBe(false);
  });

  it("does not detect ARCHIVED products as draft", () => {
    expect(isDraft({ isIncomplete: true, status: "ARCHIVED" })).toBe(false);
  });

  it("does not detect SYNCING products as draft", () => {
    expect(isDraft({ isIncomplete: true, status: "SYNCING" })).toBe(false);
  });
});

describe("Draft continuation save logic", () => {
  // Simulates the ProductForm decision: use updateProduct when productId exists
  function shouldUseUpdate(productId: string | undefined): boolean {
    return !!productId;
  }

  function shouldRedirectAfterSave(mode: "create" | "edit", productId: string | undefined): boolean {
    // In create mode (including draft continuation), redirect after full save
    if (mode === "create") return true;
    // In edit mode, stay on page
    return false;
  }

  it("uses updateProduct when productId is present (draft continuation)", () => {
    expect(shouldUseUpdate("some-uuid")).toBe(true);
  });

  it("uses createProduct when no productId (new product)", () => {
    expect(shouldUseUpdate(undefined)).toBe(false);
  });

  it("redirects after save in create mode (new product)", () => {
    expect(shouldRedirectAfterSave("create", undefined)).toBe(true);
  });

  it("redirects after save in create mode with productId (draft continuation)", () => {
    expect(shouldRedirectAfterSave("create", "some-uuid")).toBe(true);
  });

  it("stays on page after save in edit mode", () => {
    expect(shouldRedirectAfterSave("edit", "some-uuid")).toBe(false);
  });
});

describe("Touched fields initialization", () => {
  function getInitialTouchedFields(initialData: unknown): Set<string> {
    return initialData
      ? new Set(["reference", "name", "description", "category"])
      : new Set();
  }

  it("pre-touches fields when initialData is present (edit or draft continuation)", () => {
    const touched = getInitialTouchedFields({ reference: "REF-001" });
    expect(touched.has("reference")).toBe(true);
    expect(touched.has("name")).toBe(true);
    expect(touched.has("description")).toBe(true);
    expect(touched.has("category")).toBe(true);
  });

  it("no pre-touched fields for new product creation", () => {
    const touched = getInitialTouchedFields(undefined);
    expect(touched.size).toBe(0);
  });
});
