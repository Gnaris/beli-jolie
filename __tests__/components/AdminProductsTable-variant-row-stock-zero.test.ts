import { describe, it, expect } from "vitest";
import { computeVariantRowClass } from "@/components/admin/products/AdminProductsTable";

describe("computeVariantRowClass — fond rouge quand stock = 0 ou variante désactivée", () => {
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

  it("applique le même fond rouge quand la variante est désactivée, même avec du stock", () => {
    const cls = computeVariantRowClass(15, true);
    expect(cls).toContain("bg-red-100/70");
    expect(cls).toContain("hover:bg-red-200/60");
  });

  it("cumule stock=0 et disabled=true sans doubler la classe", () => {
    const cls = computeVariantRowClass(0, true);
    expect(cls).toContain("bg-red-100/70");
    expect(cls.match(/bg-red-100\/70/g)?.length).toBe(1);
  });

  it("garde le fond neutre quand disabled=false explicite avec du stock", () => {
    const cls = computeVariantRowClass(5, false);
    expect(cls).not.toContain("bg-red-100/70");
    expect(cls).toContain("hover:bg-bg-primary/60");
  });

  it("conserve les classes de base (bordure + transition) dans tous les cas", () => {
    for (const [stock, disabled] of [[0, false], [1, false], [42, true], [0, true]] as const) {
      const cls = computeVariantRowClass(stock, disabled);
      expect(cls).toContain("border-t");
      expect(cls).toContain("border-border-light");
      expect(cls).toContain("transition-colors");
    }
  });
});
