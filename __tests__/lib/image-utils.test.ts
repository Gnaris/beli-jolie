/**
 * Tests for lib/image-utils.ts
 * Client-safe image path utilities for local-storage images.
 */
import { describe, it, expect } from "vitest";
import { getImagePaths, resolveImageUrl, getImageSrc } from "@/lib/image-utils";

describe("lib/image-utils", () => {
  // ─── getImagePaths ─────────────────────────────────────────────

  describe("getImagePaths", () => {
    it("derives thumb and medium from a standard webp path", () => {
      const paths = getImagePaths("/uploads/products/abc123.webp");
      expect(paths.large).toBe("/uploads/products/abc123.webp");
      expect(paths.medium).toBe("/uploads/products/abc123_md.webp");
      expect(paths.thumb).toBe("/uploads/products/abc123_thumb.webp");
    });

    it("handles nested paths", () => {
      const paths = getImagePaths("/uploads/products/2026/03/img.webp");
      expect(paths.large).toBe("/uploads/products/2026/03/img.webp");
      expect(paths.medium).toBe("/uploads/products/2026/03/img_md.webp");
      expect(paths.thumb).toBe("/uploads/products/2026/03/img_thumb.webp");
    });

    it("handles non-webp extensions", () => {
      const paths = getImagePaths("/uploads/products/old.jpg");
      expect(paths.large).toBe("/uploads/products/old.jpg");
      expect(paths.medium).toBe("/uploads/products/old_md.jpg");
      expect(paths.thumb).toBe("/uploads/products/old_thumb.jpg");
    });

    it("handles paths without extension", () => {
      const paths = getImagePaths("/uploads/products/noext");
      expect(paths.large).toBe("/uploads/products/noext");
      expect(paths.medium).toBe("/uploads/products/noext");
      expect(paths.thumb).toBe("/uploads/products/noext");
    });

    it("handles filenames with multiple dots", () => {
      const paths = getImagePaths("/uploads/my.file.name.webp");
      expect(paths.large).toBe("/uploads/my.file.name.webp");
      expect(paths.medium).toBe("/uploads/my.file.name_md.webp");
      expect(paths.thumb).toBe("/uploads/my.file.name_thumb.webp");
    });
  });

  // ─── resolveImageUrl ──────────────────────────────────────────

  describe("resolveImageUrl", () => {
    it("returns placeholder for null/undefined/empty", () => {
      expect(resolveImageUrl(null)).toBe("/placeholder.webp");
      expect(resolveImageUrl(undefined)).toBe("/placeholder.webp");
      expect(resolveImageUrl("")).toBe("/placeholder.webp");
    });

    it("returns absolute URLs as-is", () => {
      const url = "https://cdn.example.com/image.jpg";
      expect(resolveImageUrl(url)).toBe(url);
    });

    it("returns local paths unchanged", () => {
      expect(resolveImageUrl("/uploads/products/abc.webp")).toBe(
        "/uploads/products/abc.webp",
      );
    });
  });

  // ─── getImageSrc ──────────────────────────────────────────────

  describe("getImageSrc", () => {
    it("returns placeholder for null/undefined", () => {
      expect(getImageSrc(null)).toBe("/placeholder.webp");
      expect(getImageSrc(undefined)).toBe("/placeholder.webp");
    });

    it("returns absolute URLs as-is", () => {
      const url = "https://cdn.pfs.com/image.jpg";
      expect(getImageSrc(url, "thumb")).toBe(url);
    });

    it("returns non-webp files as-is (legacy)", () => {
      expect(getImageSrc("/uploads/old.jpg", "thumb")).toBe("/uploads/old.jpg");
    });

    it("returns the right local path per size", () => {
      const path = "/uploads/products/abc.webp";
      expect(getImageSrc(path, "large")).toBe("/uploads/products/abc.webp");
      expect(getImageSrc(path, "medium")).toBe("/uploads/products/abc_md.webp");
      expect(getImageSrc(path, "thumb")).toBe("/uploads/products/abc_thumb.webp");
    });

    it("defaults to large size", () => {
      expect(getImageSrc("/uploads/products/abc.webp")).toBe(
        "/uploads/products/abc.webp",
      );
    });
  });
});
