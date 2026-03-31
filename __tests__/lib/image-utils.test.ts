/**
 * Tests for lib/image-utils.ts
 * Client-safe image path utilities for R2 storage.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("lib/image-utils", () => {
  // ─── getImagePaths ─────────────────────────────────────────────

  describe("getImagePaths", () => {
    let getImagePaths: typeof import("@/lib/image-utils").getImagePaths;

    beforeEach(async () => {
      vi.resetModules();
      const mod = await import("@/lib/image-utils");
      getImagePaths = mod.getImagePaths;
    });

    it("should derive thumb and medium from standard webp path", () => {
      const paths = getImagePaths("/uploads/products/abc123.webp");
      expect(paths.large).toBe("/uploads/products/abc123.webp");
      expect(paths.medium).toBe("/uploads/products/abc123_md.webp");
      expect(paths.thumb).toBe("/uploads/products/abc123_thumb.webp");
    });

    it("should handle nested paths", () => {
      const paths = getImagePaths("/uploads/products/2026/03/img.webp");
      expect(paths.large).toBe("/uploads/products/2026/03/img.webp");
      expect(paths.medium).toBe("/uploads/products/2026/03/img_md.webp");
      expect(paths.thumb).toBe("/uploads/products/2026/03/img_thumb.webp");
    });

    it("should handle non-webp extensions", () => {
      const paths = getImagePaths("/uploads/products/old.jpg");
      expect(paths.large).toBe("/uploads/products/old.jpg");
      expect(paths.medium).toBe("/uploads/products/old_md.jpg");
      expect(paths.thumb).toBe("/uploads/products/old_thumb.jpg");
    });

    it("should handle paths without extension", () => {
      const paths = getImagePaths("/uploads/products/noext");
      expect(paths.large).toBe("/uploads/products/noext");
      expect(paths.medium).toBe("/uploads/products/noext");
      expect(paths.thumb).toBe("/uploads/products/noext");
    });

    it("should handle filenames with multiple dots", () => {
      const paths = getImagePaths("/uploads/my.file.name.webp");
      expect(paths.large).toBe("/uploads/my.file.name.webp");
      expect(paths.medium).toBe("/uploads/my.file.name_md.webp");
      expect(paths.thumb).toBe("/uploads/my.file.name_thumb.webp");
    });
  });

  // ─── resolveImageUrl ──────────────────────────────────────────

  describe("resolveImageUrl", () => {
    let resolveImageUrl: typeof import("@/lib/image-utils").resolveImageUrl;

    beforeEach(async () => {
      vi.resetModules();
      process.env.NEXT_PUBLIC_R2_URL = "https://pub-xxx.r2.dev";
      const mod = await import("@/lib/image-utils");
      resolveImageUrl = mod.resolveImageUrl;
    });

    it("should return placeholder for null/undefined", () => {
      expect(resolveImageUrl(null)).toBe("/placeholder.webp");
      expect(resolveImageUrl(undefined)).toBe("/placeholder.webp");
      expect(resolveImageUrl("")).toBe("/placeholder.webp");
    });

    it("should return full URL as-is", () => {
      const url = "https://cdn.example.com/image.jpg";
      expect(resolveImageUrl(url)).toBe(url);
    });

    it("should prepend R2 URL to relative path", () => {
      expect(resolveImageUrl("/uploads/products/abc.webp")).toBe(
        "https://pub-xxx.r2.dev/uploads/products/abc.webp"
      );
    });
  });

  // ─── getImageSrc ──────────────────────────────────────────────

  describe("getImageSrc", () => {
    let getImageSrc: typeof import("@/lib/image-utils").getImageSrc;

    beforeEach(async () => {
      vi.resetModules();
      process.env.NEXT_PUBLIC_R2_URL = "https://pub-xxx.r2.dev";
      const mod = await import("@/lib/image-utils");
      getImageSrc = mod.getImageSrc;
    });

    it("should return placeholder for null/undefined", () => {
      expect(getImageSrc(null)).toBe("/placeholder.webp");
      expect(getImageSrc(undefined)).toBe("/placeholder.webp");
    });

    it("should return full URLs as-is", () => {
      const url = "https://cdn.pfs.com/image.jpg";
      expect(getImageSrc(url, "thumb")).toBe(url);
    });

    it("should return non-webp files as-is (legacy)", () => {
      expect(getImageSrc("/uploads/old.jpg", "thumb")).toBe("/uploads/old.jpg");
    });

    it("should return correct size for webp with R2 URL", () => {
      const path = "/uploads/products/abc.webp";
      expect(getImageSrc(path, "large")).toBe("https://pub-xxx.r2.dev/uploads/products/abc.webp");
      expect(getImageSrc(path, "medium")).toBe("https://pub-xxx.r2.dev/uploads/products/abc_md.webp");
      expect(getImageSrc(path, "thumb")).toBe("https://pub-xxx.r2.dev/uploads/products/abc_thumb.webp");
    });

    it("should default to large size", () => {
      const path = "/uploads/products/abc.webp";
      expect(getImageSrc(path)).toBe("https://pub-xxx.r2.dev/uploads/products/abc.webp");
    });
  });
});
