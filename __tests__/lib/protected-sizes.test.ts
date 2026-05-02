import { describe, it, expect } from "vitest";
import {
  isProtectedSizeName,
  isProtectedSizeVirtualId,
  withProtectedSize,
  withProtectedSizeItem,
  PROTECTED_SIZE_NAME,
  PROTECTED_SIZE_PFS_REF,
  PROTECTED_SIZE_VIRTUAL_ID,
} from "@/lib/protected-sizes";

describe("lib/protected-sizes", () => {
  describe("isProtectedSizeName", () => {
    it("matches « Taille unique » regardless of casing and trim", () => {
      expect(isProtectedSizeName("Taille unique")).toBe(true);
      expect(isProtectedSizeName("  taille UNIQUE  ")).toBe(true);
    });

    it("rejects unrelated names and falsy values", () => {
      expect(isProtectedSizeName("Taille")).toBe(false);
      expect(isProtectedSizeName(null)).toBe(false);
      expect(isProtectedSizeName(undefined)).toBe(false);
      expect(isProtectedSizeName("")).toBe(false);
    });
  });

  describe("isProtectedSizeVirtualId", () => {
    it("matches the virtual placeholder", () => {
      expect(isProtectedSizeVirtualId(PROTECTED_SIZE_VIRTUAL_ID)).toBe(true);
    });

    it("rejects real cuids and falsy values", () => {
      expect(isProtectedSizeVirtualId("clx_real_cuid")).toBe(false);
      expect(isProtectedSizeVirtualId(null)).toBe(false);
      expect(isProtectedSizeVirtualId(undefined)).toBe(false);
    });
  });

  describe("withProtectedSize", () => {
    it("prepends a virtual « Taille unique » entry when missing", () => {
      const result = withProtectedSize([
        { id: "s1", name: "M" },
        { id: "s2", name: "L" },
      ]);
      expect(result[0]).toEqual({ id: PROTECTED_SIZE_VIRTUAL_ID, name: PROTECTED_SIZE_NAME });
      expect(result).toHaveLength(3);
    });

    it("returns the list unchanged when the protected size is already present", () => {
      const sizes = [
        { id: "real-tu", name: "Taille unique" },
        { id: "s1", name: "M" },
      ];
      const result = withProtectedSize(sizes);
      expect(result).toBe(sizes);
    });

    it("returns just the virtual entry when input is empty", () => {
      const result = withProtectedSize([]);
      expect(result).toEqual([{ id: PROTECTED_SIZE_VIRTUAL_ID, name: PROTECTED_SIZE_NAME }]);
    });
  });

  describe("withProtectedSizeItem", () => {
    it("prepends a fully-formed protected item when missing", () => {
      const result = withProtectedSizeItem([
        { id: "s1", name: "M", position: 1, variantCount: 3, pfsSizeRef: "M_EU" },
      ]);
      expect(result[0]).toEqual({
        id: PROTECTED_SIZE_VIRTUAL_ID,
        name: PROTECTED_SIZE_NAME,
        position: 0,
        variantCount: 0,
        pfsSizeRef: PROTECTED_SIZE_PFS_REF,
      });
    });

    it("returns the list unchanged when the protected item is already present", () => {
      const items = [
        { id: "real-tu", name: "Taille unique", position: 0, variantCount: 5, pfsSizeRef: "TU" },
        { id: "s1", name: "M", position: 1, variantCount: 3, pfsSizeRef: "M_EU" },
      ];
      const result = withProtectedSizeItem(items);
      expect(result).toBe(items);
    });
  });
});
