/**
 * `filterImportable` doit exclure les produits PFS déjà présents chez nous
 * SOIT par référence, SOIT par `pfsProductId`. Le 2ᵉ critère bloque le cas
 * où la cliente a renommé un produit côté PFS : la ref change, mais l'ID
 * PFS reste identique — sans ce filtre, l'INSERT casse la contrainte unique
 * `(tenantId, pfsProductId)` et l'import fait des erreurs répétées.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PfsProduct } from "@/lib/pfs-api";

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { product: { findMany: findManyMock } },
}));

const { filterImportable } = await import("@/lib/pfs-import");

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

describe("filterImportable", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("exclut un produit dont la référence existe déjà en base", async () => {
    findManyMock.mockResolvedValue([{ reference: "818", pfsProductId: "pro_other" }]);
    const kept = await filterImportable([mkPfsProduct("pro_new", "818")]);
    expect(kept).toHaveLength(0);
  });

  it("exclut un produit dont le pfsProductId existe déjà (ref renommée côté PFS)", async () => {
    // Chez nous : ref TEDDYOFFICIER avec pfsProductId pro_fb5d.
    // PFS renvoie maintenant ref « 818 » (renommée) mais pfsProductId identique.
    findManyMock.mockResolvedValue([
      { reference: "TEDDYOFFICIER", pfsProductId: "pro_fb5d" },
    ]);
    const kept = await filterImportable([mkPfsProduct("pro_fb5d", "818")]);
    expect(kept).toHaveLength(0);
  });

  it("garde un produit dont la ref ET le pfsProductId sont nouveaux", async () => {
    findManyMock.mockResolvedValue([]);
    const p = mkPfsProduct("pro_new", "NEWREF");
    const kept = await filterImportable([p]);
    expect(kept).toEqual([p]);
  });

  it("interroge la BDD avec la ref normalisée en MAJUSCULES et l'id brut", async () => {
    findManyMock.mockResolvedValue([]);
    await filterImportable([mkPfsProduct("pro_abc", "  818leo  ")]);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { reference: { in: ["818LEO"] } },
          { pfsProductId: { in: ["pro_abc"] } },
        ],
      },
      select: { reference: true, pfsProductId: true },
    });
  });
});
