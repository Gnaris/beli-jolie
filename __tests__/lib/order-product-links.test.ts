/**
 * Tests du mapping ref → URL fiche produit construit sur les pages de commande.
 *
 * On teste indirectement via `buildProductHandle` — la logique de la page
 * client est un simple `Object.assign` de `ref → /{locale}/produits/{handle}`
 * pour chaque ref unique. Le comportement critique à couvrir est le format
 * du handle produit (utilisé côté SEO + navigation).
 */
import { describe, it, expect } from "vitest";
import { buildProductHandle, parseProductHandle } from "@/lib/product-url";

describe("mapping ref → URL fiche produit (page commande)", () => {
  it("buildProductHandle produit un slug name-ref lowercase", () => {
    expect(buildProductHandle("Bague dorée fine", "E310B")).toBe("bague-doree-fine-e310b");
  });

  it("buildProductHandle tolère nom vide", () => {
    expect(buildProductHandle("", "E310B")).toBe("e310b");
  });

  it("buildProductHandle tolère référence vide", () => {
    expect(buildProductHandle("Bague dorée", "")).toBe("bague-doree");
  });

  it("parseProductHandle retrouve la référence dans un handle name-ref", () => {
    const parsed = parseProductHandle("bague-doree-fine-e310b");
    expect(parsed.referenceCandidates).toContain("e310b");
  });

  it("la construction du mapping côté client dédoublonne par ref", () => {
    // Simulation du bloc dans app/[locale]/(client)/commandes/[id]/page.tsx
    const items = [
      { productName: "Bague A", productRef: "REF1" },
      { productName: "Bague A", productRef: "REF1" }, // doublon
      { productName: "Bracelet B", productRef: "REF2" },
    ];
    const locale = "fr";
    const productLinks: Record<string, string> = {};
    const seenRefs = new Set<string>();
    for (const it of items) {
      if (!it.productRef || seenRefs.has(it.productRef)) continue;
      seenRefs.add(it.productRef);
      const handle = buildProductHandle(it.productName, it.productRef);
      if (handle) productLinks[it.productRef] = `/${locale}/produits/${handle}`;
    }
    expect(productLinks).toEqual({
      REF1: "/fr/produits/bague-a-ref1",
      REF2: "/fr/produits/bracelet-b-ref2",
    });
  });

  it("la construction du mapping côté admin utilise la route ref intermédiaire", () => {
    // Simulation du bloc dans app/(admin)/admin/commandes/[id]/page.tsx
    const items = [
      { productRef: "A2251" },
      { productRef: "A2251(2)" }, // parenthèses = doivent être encodées
    ];
    const productLinks: Record<string, string> = {};
    for (const it of items) {
      if (it.productRef && !productLinks[it.productRef]) {
        productLinks[it.productRef] = `/admin/produits/ref/${encodeURIComponent(it.productRef)}`;
      }
    }
    expect(productLinks).toEqual({
      A2251: "/admin/produits/ref/A2251",
      "A2251(2)": "/admin/produits/ref/A2251(2)",
    });
  });
});
