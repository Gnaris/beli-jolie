/**
 * Tests unitaires du helper `lib/mapping-impact.ts` : construction du `where`
 * Prisma pour compter les produits impactés (par attribut × marketplace) et
 * fabrication du `MappingChangeSummary` (retourne null si personne n'est
 * impacté, sinon les libellés + rollback fields sont bien portés).
 *
 * Prisma est mocké — on vérifie que le `where` généré est correct et que la
 * couche `buildMappingImpactSummary` interprète bien le count.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock: any = {
  product: {
    findMany: vi.fn(),
  },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { analyzeMappingImpact, buildMappingImpactSummary, marketplaceLabel, marketplaceSyncRequiredField } =
  await import("@/lib/mapping-impact");

beforeEach(() => {
  prismaMock.product.findMany.mockReset();
});

describe("analyzeMappingImpact — where Prisma", () => {
  it("season / pfs → filtre seasonId + pfsProductId non-null + non archivé", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await analyzeMappingImpact({ attribute: "season", marketplace: "pfs", localId: "s-1" });
    const args = prismaMock.product.findMany.mock.calls[0][0];
    expect(args.where.AND).toEqual([
      { seasonId: "s-1" },
      { pfsProductId: { not: null } },
      { status: { not: "ARCHIVED" } },
    ]);
  });

  it("category / faire → filtre categoryId + faireProductId non-null", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await analyzeMappingImpact({ attribute: "category", marketplace: "faire", localId: "c-1" });
    const args = prismaMock.product.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual({ categoryId: "c-1" });
    expect(args.where.AND[1]).toEqual({ faireProductId: { not: null } });
  });

  it("composition / efashion → filtre compositions.some.compositionId + efashionReferenceBase", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await analyzeMappingImpact({
      attribute: "composition",
      marketplace: "efashion",
      localId: "cp-1",
    });
    const args = prismaMock.product.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual({ compositions: { some: { compositionId: "cp-1" } } });
    expect(args.where.AND[1]).toEqual({ efashionReferenceBase: { not: null } });
  });

  it("color / efashion → filtre couvre variantes + packs + primary", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    await analyzeMappingImpact({ attribute: "color", marketplace: "efashion", localId: "col-1" });
    const args = prismaMock.product.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual({
      OR: [
        { colors: { some: { colorId: "col-1" } } },
        { colors: { some: { packLines: { some: { colorId: "col-1" } } } } },
        { primaryColorId: "col-1" },
      ],
    });
  });
});

describe("analyzeMappingImpact — mapping des résultats", () => {
  it("map les produits avec la première image de la couleur principale", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: "p-1",
        reference: "REF-1",
        name: "Produit 1",
        colors: [{ images: [{ path: "/uploads/x.webp" }] }],
      },
      {
        id: "p-2",
        reference: "REF-2",
        name: "Produit 2",
        colors: [], // pas de couleur principale
      },
    ]);
    const res = await analyzeMappingImpact({
      attribute: "season",
      marketplace: "pfs",
      localId: "s-1",
    });
    expect(res.count).toBe(2);
    expect(res.products).toEqual([
      { id: "p-1", reference: "REF-1", name: "Produit 1", firstImage: "/uploads/x.webp" },
      { id: "p-2", reference: "REF-2", name: "Produit 2", firstImage: null },
    ]);
  });

  it("count = 0 quand aucun produit publié", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const res = await analyzeMappingImpact({
      attribute: "season",
      marketplace: "pfs",
      localId: "s-orphan",
    });
    expect(res.count).toBe(0);
    expect(res.products).toEqual([]);
  });
});

describe("buildMappingImpactSummary", () => {
  it("retourne null si count = 0 (pas de modale)", async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const out = await buildMappingImpactSummary({
      attribute: "season",
      marketplace: "pfs",
      localId: "s-1",
      localName: "Toutes saisons",
      oldValueLabel: "PE2026",
      newValueLabel: "AH2026",
      rollbackFields: { pfsRef: "PE2026" },
    });
    expect(out).toBeNull();
  });

  it("retourne le summary complet quand des produits sont impactés", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p-1", reference: "R1", name: "N1", colors: [] },
      { id: "p-2", reference: "R2", name: "N2", colors: [] },
      { id: "p-3", reference: "R3", name: "N3", colors: [] },
    ]);
    const out = await buildMappingImpactSummary({
      attribute: "season",
      marketplace: "pfs",
      localId: "s-1",
      localName: "Toutes saisons",
      oldValueLabel: "PE2026",
      newValueLabel: "AH2026",
      rollbackFields: { pfsRef: "PE2026" },
    });
    expect(out).toEqual({
      attribute: "season",
      marketplace: "pfs",
      localId: "s-1",
      localName: "Toutes saisons",
      count: 3,
      oldValueLabel: "PE2026",
      newValueLabel: "AH2026",
      rollbackFields: { pfsRef: "PE2026" },
    });
  });

  it("préserve rollbackFields multi-champs (cas Category/PFS)", async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: "p-1", reference: "R1", name: "N1", colors: [] },
    ]);
    const out = await buildMappingImpactSummary({
      attribute: "category",
      marketplace: "pfs",
      localId: "c-1",
      localName: "Bagues",
      oldValueLabel: "Femme > Bijoux > Bagues",
      newValueLabel: "Homme > Bijoux > Bagues",
      rollbackFields: {
        pfsGender: "Femme",
        pfsFamilyName: "Bijoux",
        pfsCategoryName: "Bagues",
      },
    });
    expect(out?.rollbackFields).toEqual({
      pfsGender: "Femme",
      pfsFamilyName: "Bijoux",
      pfsCategoryName: "Bagues",
    });
  });
});

describe("marketplaceLabel", () => {
  it("retourne le nom lisible du marketplace", () => {
    expect(marketplaceLabel("pfs")).toBe("Paris Fashion Shop");
    expect(marketplaceLabel("efashion")).toBe("eFashion");
    expect(marketplaceLabel("faire")).toBe("Faire");
  });
});

describe("marketplaceSyncRequiredField", () => {
  it("retourne le nom du champ Product.*SyncRequired par marketplace", () => {
    expect(marketplaceSyncRequiredField("pfs")).toBe("pfsSyncRequired");
    expect(marketplaceSyncRequiredField("efashion")).toBe("efashionSyncRequired");
    expect(marketplaceSyncRequiredField("faire")).toBe("faireSyncRequired");
  });
});
