import { describe, it, expect } from "vitest";
import { shouldBypassOptimizer } from "@/components/ui/SmartImage";

describe("shouldBypassOptimizer", () => {
  it("bypasses optimizer for /uploads/ paths (added after process start)", () => {
    expect(shouldBypassOptimizer("/uploads/products/abc.webp")).toBe(true);
    expect(shouldBypassOptimizer("/uploads/banners/hero.webp")).toBe(true);
  });

  it("keeps optimizer for other static assets bundled at build time", () => {
    expect(shouldBypassOptimizer("/placeholder.webp")).toBe(false);
    expect(shouldBypassOptimizer("/icons/star.svg")).toBe(false);
    expect(shouldBypassOptimizer("/google0ad64ae6fafff13d.html")).toBe(false);
  });

  it("keeps optimizer for absolute URLs (PFS CDN, etc.)", () => {
    expect(shouldBypassOptimizer("https://static.parisfashionshops.com/x.jpg")).toBe(false);
    expect(shouldBypassOptimizer("http://example.com/img.png")).toBe(false);
  });

  it("does not crash for non-string sources (StaticImageData)", () => {
    expect(shouldBypassOptimizer({ src: "/foo.png", height: 10, width: 10 })).toBe(false);
  });
});
