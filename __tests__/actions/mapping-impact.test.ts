/**
 * Tests unitaires des server actions déclenchées par la modale
 * `MappingChangeImpactModal` (fichier
 * `app/actions/admin/mapping-impact.ts`).
 *
 * On mocke Prisma et l'analyse d'impact pour vérifier que :
 *   - `loadImpactedProductsForSync` renvoie bien la liste des produits
 *   - `markImpactedProductsSyncRequired` pose le bon flag Prisma updateMany
 *   - `rollbackMappingChange` ré-écrit sur le bon modèle et champ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { id: "u", role: "ADMIN", status: "APPROVED", email: "a@b.c" },
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((fn: Function) => fn),
}));

const prismaMock: any = {
  product: {
    findMany: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  season: { update: vi.fn().mockResolvedValue({}) },
  category: { update: vi.fn().mockResolvedValue({}) },
  color: { update: vi.fn().mockResolvedValue({}) },
  composition: { update: vi.fn().mockResolvedValue({}) },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  loadImpactedProductsForSync,
  markImpactedProductsSyncRequired,
  rollbackMappingChange,
} = await import("@/app/actions/admin/mapping-impact");

beforeEach(() => {
  prismaMock.product.findMany.mockReset();
  prismaMock.product.updateMany.mockReset().mockResolvedValue({ count: 0 });
  prismaMock.season.update.mockReset().mockResolvedValue({});
  prismaMock.category.update.mockReset().mockResolvedValue({});
  prismaMock.color.update.mockReset().mockResolvedValue({});
  prismaMock.composition.update.mockReset().mockResolvedValue({});
});

describe("loadImpactedProductsForSync", () => {
  it("retourne la liste des produits impactés (id + méta)", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: "p-1",
        reference: "REF-1",
        name: "Produit 1",
        colors: [{ images: [{ path: "/uploads/x.webp" }] }],
      },
    ]);
    const res = await loadImpactedProductsForSync("season", "pfs", "s-1");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.products).toEqual([
        { id: "p-1", reference: "REF-1", name: "Produit 1", firstImage: "/uploads/x.webp" },
      ]);
    }
  });

  it("retourne success:true avec liste vide si aucun produit", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const res = await loadImpactedProductsForSync("season", "pfs", "s-1");
    expect(res.success).toBe(true);
    if (res.success) expect(res.products).toEqual([]);
  });
});

describe("markImpactedProductsSyncRequired", () => {
  it("pose pfsSyncRequired=true sur les produits impactés (PFS)", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p-1", reference: "R1", name: "N1", colors: [] },
      { id: "p-2", reference: "R2", name: "N2", colors: [] },
    ]);
    const res = await markImpactedProductsSyncRequired("season", "pfs", "s-1");
    expect(res.success).toBe(true);
    if (res.success) expect(res.count).toBe(2);
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p-1", "p-2"] } },
      data: { pfsSyncRequired: true },
    });
  });

  it("pose efashionSyncRequired=true pour eFashion", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p-1", reference: "R1", name: "N1", colors: [] },
    ]);
    await markImpactedProductsSyncRequired("category", "efashion", "c-1");
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p-1"] } },
      data: { efashionSyncRequired: true },
    });
  });

  it("pose faireSyncRequired=true pour Faire", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p-1", reference: "R1", name: "N1", colors: [] },
    ]);
    await markImpactedProductsSyncRequired("category", "faire", "c-1");
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p-1"] } },
      data: { faireSyncRequired: true },
    });
  });

  it("no-op si aucun produit impacté (n'appelle pas updateMany)", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const res = await markImpactedProductsSyncRequired("season", "pfs", "s-orphan");
    expect(res.success).toBe(true);
    if (res.success) expect(res.count).toBe(0);
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
  });
});

describe("rollbackMappingChange", () => {
  it("Season : ré-écrit pfsRef sur prisma.season", async () => {
    await rollbackMappingChange("season", "s-1", { pfsRef: "PE2026" });
    expect(prismaMock.season.update).toHaveBeenCalledWith({
      where: { id: "s-1" },
      data: { pfsRef: "PE2026" },
    });
  });

  it("Category : ré-écrit les 3 champs PFS d'un coup", async () => {
    await rollbackMappingChange("category", "c-1", {
      pfsGender: "Femme",
      pfsFamilyName: "Bijoux",
      pfsCategoryName: "Bagues",
    });
    expect(prismaMock.category.update).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: {
        pfsGender: "Femme",
        pfsFamilyName: "Bijoux",
        pfsCategoryName: "Bagues",
      },
    });
  });

  it("Color : ré-écrit efashionColorId à sa valeur ancienne (null accepté)", async () => {
    await rollbackMappingChange("color", "col-1", { efashionColorId: null });
    expect(prismaMock.color.update).toHaveBeenCalledWith({
      where: { id: "col-1" },
      data: { efashionColorId: null },
    });
  });

  it("Composition : ré-écrit pfsCompositionRef sur prisma.composition", async () => {
    await rollbackMappingChange("composition", "cp-1", { pfsCompositionRef: "COT01" });
    expect(prismaMock.composition.update).toHaveBeenCalledWith({
      where: { id: "cp-1" },
      data: { pfsCompositionRef: "COT01" },
    });
  });

  it("retourne success:false avec le message si Prisma échoue", async () => {
    prismaMock.season.update.mockRejectedValue(new Error("db down"));
    const res = await rollbackMappingChange("season", "s-1", { pfsRef: null });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("db down");
  });
});
