/**
 * Filet de sécurité au moment du clic « Importer » : si le picker a affiché
 * un produit PFS déjà présent dans la boutique (ref identique OU pfsProductId
 * identique après un renommage côté PFS), l'import doit s'arrêter proprement
 * avec un message clair — pas casser la contrainte unique
 * `(tenantId, pfsProductId)` en Prisma.
 *
 * Régression : boutique Issyma, produit 15192LEO — même id PFS que
 * l'existant local, ref différente → l'ancien pré-check (par ref seule)
 * laissait passer et Prisma renvoyait « Unique constraint failed ».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PfsProduct } from "@/lib/pfs-api";

const {
  productFindFirstMock,
  getCachedPfsProductByIdMock,
  requirePfsBrandMock,
  loadPfsImportPriceMarkupMock,
} = vi.hoisted(() => ({
  productFindFirstMock: vi.fn(),
  getCachedPfsProductByIdMock: vi.fn(),
  requirePfsBrandMock: vi.fn(),
  loadPfsImportPriceMarkupMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findFirst: productFindFirstMock } },
}));
vi.mock("@/lib/pfs-list-cache", () => ({
  getCachedPfsProductById: getCachedPfsProductByIdMock,
}));
vi.mock("@/lib/pfs-brand", () => ({
  requirePfsBrand: requirePfsBrandMock,
}));
vi.mock("@/lib/pfs-import-price-markup", () => ({
  loadPfsImportPriceMarkup: loadPfsImportPriceMarkupMock,
  applyImportMarkupToUnitPrice: (v: number) => v,
}));

const { approveAndImportPfsProduct } = await import("@/lib/pfs-import");

function mkPfsProduct(id: string, reference: string): PfsProduct {
  return {
    id,
    reference,
    brand: { id: "b1", name: "B" },
    gender: "",
    family: "",
    category: { id: "cat", labels: {} },
    labels: {},
    colors: "",
    sizes: "",
    size_details_tu: "",
    unit_price: 0,
    creation_date: "",
    status: "",
    is_star: 0,
    count_variants: 0,
    images: {},
    flash_sales_discount: null,
    variants: [],
  };
}

describe("approveAndImportPfsProduct — pré-check anti-doublon", () => {
  beforeEach(() => {
    productFindFirstMock.mockReset();
    getCachedPfsProductByIdMock.mockReset();
    requirePfsBrandMock.mockReset();
    loadPfsImportPriceMarkupMock.mockReset();

    requirePfsBrandMock.mockResolvedValue({ id: "b1", name: "B" });
    loadPfsImportPriceMarkupMock.mockResolvedValue({ mode: "none" });
  });

  it("bloque si la référence existe déjà (produit déjà importé sous cette ref)", async () => {
    getCachedPfsProductByIdMock.mockResolvedValue(mkPfsProduct("pro_new", "15192LEO"));
    productFindFirstMock.mockResolvedValue({ reference: "15192LEO", pfsProductId: null });

    await expect(approveAndImportPfsProduct("pro_new", "issyma")).rejects.toThrow(
      /Produit déjà importé : 15192LEO/,
    );
  });

  it("bloque si le pfsProductId existe déjà sous une autre référence (renommage côté PFS)", async () => {
    getCachedPfsProductByIdMock.mockResolvedValue(mkPfsProduct("pro_leo", "15192LEO"));
    // Chez nous, le produit vit sous « ANCIEN15192 » mais garde le même id PFS.
    productFindFirstMock.mockResolvedValue({
      reference: "ANCIEN15192",
      pfsProductId: "pro_leo",
    });

    await expect(approveAndImportPfsProduct("pro_leo", "issyma")).rejects.toThrow(
      /Produit déjà importé sous la référence "ANCIEN15192" \(renommé côté PFS\)/,
    );
  });

  it("interroge la BDD avec le double critère (ref OR pfsProductId)", async () => {
    getCachedPfsProductByIdMock.mockResolvedValue(mkPfsProduct("pro_leo", "  15192leo  "));
    productFindFirstMock.mockResolvedValue({ reference: "X", pfsProductId: "pro_leo" });

    await expect(approveAndImportPfsProduct("pro_leo", "issyma")).rejects.toThrow();

    expect(productFindFirstMock).toHaveBeenCalledWith({
      where: {
        OR: [{ reference: "15192LEO" }, { pfsProductId: "pro_leo" }],
      },
      select: { reference: true, pfsProductId: true },
    });
  });
});
