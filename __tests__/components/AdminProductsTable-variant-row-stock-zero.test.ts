import { describe, it, expect } from "vitest";
import { computeVariantRowClass } from "@/components/admin/products/AdminProductsTable";

describe("computeVariantRowClass — fond rouge quand stock = 0", () => {
  it("applique un fond rouge quand le stock vaut 0", () => {
    const cls = computeVariantRowClass(0);
    expect(cls).toContain("bg-red-100/70");
    expect(cls).toContain("hover:bg-red-200/60");
    expect(cls).not.toContain("hover:bg-bg-primary/60");
  });

  it("garde le fond neutre quand le stock est positif", () => {
    const cls = computeVariantRowClass(3);
    expect(cls).not.toContain("bg-red-100/70");
    expect(cls).toContain("hover:bg-bg-primary/60");
  });

  it("garde le fond neutre pour un stock élevé", () => {
    const cls = computeVariantRowClass(999);
    expect(cls).not.toContain("bg-red-100/70");
    expect(cls).toContain("hover:bg-bg-primary/60");
  });

  it("conserve les classes de base (bordure + transition) dans les deux cas", () => {
    for (const stock of [0, 1, 42]) {
      const cls = computeVariantRowClass(stock);
      expect(cls).toContain("border-t");
      expect(cls).toContain("border-border-light");
      expect(cls).toContain("transition-colors");
    }
  });
});
