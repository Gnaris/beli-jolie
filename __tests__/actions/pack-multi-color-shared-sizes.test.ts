import { describe, it, expect } from "vitest";
import { validateVariants } from "@/lib/product-variant-validation";
import type { ColorInput } from "@/lib/product-variant-validation";

function packMultiColor(packLines: { colorId: string; sizes: { sizeId: string; quantity: number }[] }[]): ColorInput {
  const totalQty = packLines.reduce((s, l) => s + l.sizes.reduce((a, sz) => a + sz.quantity, 0), 0);
  return {
    colorId: packLines[0].colorId,
    unitPrice: 5,
    weight: 0.1,
    stock: 1,
    isPrimary: true,
    saleType: "PACK",
    packQuantity: totalQty,
    sizeEntries: [],
    packLines: packLines.map((l) => ({
      colorId: l.colorId,
      sizeEntries: l.sizes.map((sz) => ({ sizeId: sz.sizeId, quantity: sz.quantity })),
    })),
  };
}

describe("validateVariants — tailles partagées dans un pack multi-couleurs", () => {
  it("accepte un pack multi-couleurs où toutes les couleurs ont les mêmes tailles", () => {
    const v = packMultiColor([
      { colorId: "ecru", sizes: [{ sizeId: "48", quantity: 12 }, { sizeId: "49", quantity: 12 }] },
      { colorId: "ivoire", sizes: [{ sizeId: "48", quantity: 12 }, { sizeId: "49", quantity: 12 }] },
    ]);
    expect(() => validateVariants([v])).not.toThrow();
  });

  it("accepte des quantités différentes par couleur tant que les tailles sont identiques", () => {
    // Reproduit le paquet n°2 de TESTGGG sur PFS
    const v = packMultiColor([
      { colorId: "ecru", sizes: [
        { sizeId: "48", quantity: 3 },
        { sizeId: "49", quantity: 4 },
        { sizeId: "50", quantity: 5 },
        { sizeId: "53", quantity: 6 },
      ] },
      { colorId: "ivoire", sizes: [
        { sizeId: "48", quantity: 2 },
        { sizeId: "49", quantity: 2 },
        { sizeId: "50", quantity: 2 },
        { sizeId: "53", quantity: 2 },
      ] },
    ]);
    expect(() => validateVariants([v])).not.toThrow();
  });

  it("rejette quand les couleurs ont des tailles différentes", () => {
    const v = packMultiColor([
      { colorId: "ecru", sizes: [{ sizeId: "48", quantity: 12 }, { sizeId: "49", quantity: 12 }] },
      { colorId: "ivoire", sizes: [{ sizeId: "48", quantity: 12 }, { sizeId: "50", quantity: 12 }] },
    ]);
    expect(() => validateVariants([v])).toThrow(/mêmes tailles/i);
  });

  it("rejette quand une couleur a une taille en plus que les autres", () => {
    const v = packMultiColor([
      { colorId: "ecru", sizes: [{ sizeId: "48", quantity: 12 }] },
      { colorId: "ivoire", sizes: [{ sizeId: "48", quantity: 12 }, { sizeId: "49", quantity: 12 }] },
    ]);
    expect(() => validateVariants([v])).toThrow(/mêmes tailles/i);
  });

  it("autorise plusieurs paquets distincts pour un même produit", () => {
    // Reproduit TESTGGG : 2 paquets multi-couleurs distincts
    const pack1 = packMultiColor([
      { colorId: "ecru", sizes: [
        { sizeId: "48", quantity: 12 }, { sizeId: "49", quantity: 12 },
        { sizeId: "50", quantity: 12 }, { sizeId: "53", quantity: 12 },
      ] },
      { colorId: "ivoire", sizes: [
        { sizeId: "48", quantity: 12 }, { sizeId: "49", quantity: 12 },
        { sizeId: "50", quantity: 12 }, { sizeId: "53", quantity: 12 },
      ] },
    ]);
    const pack2 = packMultiColor([
      { colorId: "ecru", sizes: [
        { sizeId: "48", quantity: 3 }, { sizeId: "49", quantity: 4 },
        { sizeId: "50", quantity: 5 }, { sizeId: "53", quantity: 6 },
      ] },
      { colorId: "ivoire", sizes: [
        { sizeId: "48", quantity: 2 }, { sizeId: "49", quantity: 2 },
        { sizeId: "50", quantity: 2 }, { sizeId: "53", quantity: 2 },
      ] },
    ]);
    expect(() => validateVariants([pack1, pack2])).not.toThrow();
  });

  it("rejette deux paquets strictement identiques (mêmes couleurs, tailles ET quantités)", () => {
    const a = packMultiColor([
      { colorId: "ecru", sizes: [{ sizeId: "48", quantity: 12 }] },
      { colorId: "ivoire", sizes: [{ sizeId: "48", quantity: 12 }] },
    ]);
    const b = packMultiColor([
      { colorId: "ecru", sizes: [{ sizeId: "48", quantity: 12 }] },
      { colorId: "ivoire", sizes: [{ sizeId: "48", quantity: 12 }] },
    ]);
    expect(() => validateVariants([a, b])).toThrow(/strictement identiques/i);
  });
});
