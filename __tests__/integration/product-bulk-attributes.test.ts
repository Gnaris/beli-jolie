/**
 * Integration tests : bulkUpdateProductAttributes
 *
 * Couvre la modif en masse au niveau Product : catégorie + sous-cat, code SH,
 * composition, pays, saison, best-seller. Vérifie aussi les erreurs (FK invalide,
 * pourcentages != 100, productIds vide).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct, bulkUpdateProductAttributes } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("bulkUpdateProductAttributes (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let extraCategory: Awaited<ReturnType<typeof prisma.category.create>>;
  let extraSubCategory: Awaited<ReturnType<typeof prisma.subCategory.create>>;
  let foreignSubCategory: Awaited<ReturnType<typeof prisma.subCategory.create>>;
  let extraCountry: Awaited<ReturnType<typeof prisma.manufacturingCountry.create>>;
  let extraSeason: Awaited<ReturnType<typeof prisma.season.create>>;
  let extraComposition: Awaited<ReturnType<typeof prisma.composition.create>>;
  let hsCode: Awaited<ReturnType<typeof prisma.hsCode.create>>;
  let productIds: string[] = [];

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    extraCategory = await prisma.category.create({
      data: { name: `${TEST_PREFIX}Colliers`, slug: `${TEST_PREFIX}colliers`.toLowerCase() },
    });
    extraSubCategory = await prisma.subCategory.create({
      data: {
        name: `${TEST_PREFIX}Sautoir`,
        slug: `${TEST_PREFIX}sautoir`.toLowerCase(),
        categoryId: extraCategory.id,
      },
    });
    foreignSubCategory = await prisma.subCategory.create({
      data: {
        name: `${TEST_PREFIX}Jonc`,
        slug: `${TEST_PREFIX}jonc`.toLowerCase(),
        categoryId: entities.category.id,
      },
    });
    extraCountry = await prisma.manufacturingCountry.create({
      data: { name: `${TEST_PREFIX}Italie`, isoCode: `${TEST_PREFIX}IT` },
    });
    extraSeason = await prisma.season.create({
      data: { name: `${TEST_PREFIX}AH2025` },
    });
    extraComposition = await prisma.composition.create({
      data: { name: `${TEST_PREFIX}Coton` },
    });
    hsCode = await prisma.hsCode.create({
      data: { code: `${TEST_PREFIX}71171900`, label: "Bijouterie de fantaisie" },
    });
  });

  afterAll(async () => {
    // Nettoyage spécifique aux entités créées ici
    await prisma.productComposition.deleteMany({
      where: { product: { reference: { startsWith: TEST_PREFIX } } },
    });
    await prisma.hsCode.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
    await cleanupTestData();
  });

  // Helper : crée un produit minimal pour les tests bulk
  async function makeProduct(suffix: string): Promise<string> {
    const input: ProductInput = {
      reference: `${TEST_PREFIX}BULK-${suffix}`,
      name: `Produit bulk ${suffix}`,
      description: "Description",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 5,
          weight: 0.1,
          stock: 10,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
      compositions: [{ compositionId: entities.composition.id, percentage: 100 }],
      similarProductIds: [],
      bundleChildIds: [],
      tagNames: [],
      isBestSeller: false,
      discountPercent: null,
      status: "OFFLINE",
      dimensionLength: null,
      dimensionWidth: null,
      dimensionHeight: null,
      dimensionDiameter: null,
      dimensionCircumference: null,
      countryIsoCode: entities.country.id,
      seasonId: entities.season.id,
    };
    const r = await createProduct(input);
    return r.id;
  }

  beforeEach(async () => {
    // Re-crée 2 produits frais avant chaque test (cleanup de cascade)
    await prisma.productComposition.deleteMany({
      where: { product: { reference: { startsWith: `${TEST_PREFIX}BULK-` } } },
    });
    const variants = await prisma.productColor.findMany({
      where: { product: { reference: { startsWith: `${TEST_PREFIX}BULK-` } } },
      select: { id: true },
    });
    if (variants.length > 0) {
      await prisma.variantSize.deleteMany({ where: { productColorId: { in: variants.map((v) => v.id) } } });
      await prisma.productColor.deleteMany({ where: { id: { in: variants.map((v) => v.id) } } });
    }
    await prisma.productColorImage.deleteMany({
      where: { product: { reference: { startsWith: `${TEST_PREFIX}BULK-` } } },
    });
    await prisma.product.deleteMany({
      where: { reference: { startsWith: `${TEST_PREFIX}BULK-` } },
    });
    productIds = [await makeProduct("A"), await makeProduct("B")];
  });

  // ─────────────────────────────────────────────
  // Cas nominaux
  // ─────────────────────────────────────────────

  it("met à jour isBestSeller sur tous les produits", async () => {
    const result = await bulkUpdateProductAttributes(productIds, { isBestSeller: true });
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(0);

    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { isBestSeller: true },
    });
    expect(updated.every((p) => p.isBestSeller === true)).toBe(true);
  });

  it("désactive isBestSeller (false)", async () => {
    await bulkUpdateProductAttributes(productIds, { isBestSeller: true });
    const result = await bulkUpdateProductAttributes(productIds, { isBestSeller: false });
    expect(result.updated).toBe(2);
    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { isBestSeller: true },
    });
    expect(updated.every((p) => p.isBestSeller === false)).toBe(true);
  });

  it("met à jour le drapeau `important` sur tous les produits", async () => {
    const result = await bulkUpdateProductAttributes(productIds, { important: true });
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(0);

    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { important: true },
    });
    expect(updated.every((p) => p.important === true)).toBe(true);
  });

  it("retire le drapeau `important` (false)", async () => {
    await bulkUpdateProductAttributes(productIds, { important: true });
    const result = await bulkUpdateProductAttributes(productIds, { important: false });
    expect(result.updated).toBe(2);
    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { important: true },
    });
    expect(updated.every((p) => p.important === false)).toBe(true);
  });

  it("ne pose PAS de drapeaux syncRequired quand seul `important` est modifié", async () => {
    // Simuler des produits déjà publiés sur toutes les marketplaces.
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: {
        pfsProductId: "test-pfs-id",
        ankorsProductId: "test-ankors-id",
        efashionReferenceBase: "test-efashion-ref",
        faireProductId: "test-faire-id",
        pfsSyncRequired: false,
        ankorsSyncRequired: false,
        efashionSyncRequired: false,
        faireSyncRequired: false,
      },
    });

    const result = await bulkUpdateProductAttributes(productIds, { important: true });
    expect(result.updated).toBe(2);

    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        important: true,
        pfsSyncRequired: true,
        ankorsSyncRequired: true,
        efashionSyncRequired: true,
        faireSyncRequired: true,
      },
    });
    for (const p of updated) {
      expect(p.important).toBe(true);
      expect(p.pfsSyncRequired).toBe(false);
      expect(p.ankorsSyncRequired).toBe(false);
      expect(p.efashionSyncRequired).toBe(false);
      expect(p.faireSyncRequired).toBe(false);
    }

    // Nettoyage : retirer les identifiants marketplace fictifs pour ne pas
    // polluer les tests suivants qui pourraient s'appuyer sur un état vierge.
    await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data: {
        pfsProductId: null,
        ankorsProductId: null,
        efashionReferenceBase: null,
        faireProductId: null,
      },
    });
  });

  it("change la catégorie et vide les sous-cats existantes (héritées de l'ancienne catégorie)", async () => {
    // Pré-conditionner avec une sous-cat sur la catégorie initiale
    await prisma.product.update({
      where: { id: productIds[0] },
      data: { subCategories: { connect: { id: foreignSubCategory.id } } },
    });

    const result = await bulkUpdateProductAttributes(productIds, { categoryId: extraCategory.id });
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(0);

    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { subCategories: { select: { id: true } } },
    });
    expect(updated.every((p) => p.categoryId === extraCategory.id)).toBe(true);
    expect(updated.every((p) => p.subCategories.length === 0)).toBe(true);
  });

  it("change la catégorie et applique les sous-cats fournies", async () => {
    const result = await bulkUpdateProductAttributes(productIds, {
      categoryId: extraCategory.id,
      subCategoryIds: [extraSubCategory.id],
    });
    expect(result.updated).toBe(2);
    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { subCategories: { select: { id: true } } },
    });
    for (const p of updated) {
      expect(p.categoryId).toBe(extraCategory.id);
      expect(p.subCategories.map((s) => s.id)).toEqual([extraSubCategory.id]);
    }
  });

  it("refuse une sous-cat n'appartenant pas à la catégorie choisie", async () => {
    await expect(
      bulkUpdateProductAttributes(productIds, {
        categoryId: extraCategory.id,
        subCategoryIds: [foreignSubCategory.id], // appartient à entities.category
      }),
    ).rejects.toThrow(/sous-catégorie/);
  });

  it("met à jour le code SH (assignation puis retrait)", async () => {
    const r1 = await bulkUpdateProductAttributes(productIds, { hsCodeId: hsCode.id });
    expect(r1.updated).toBe(2);
    let updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { hsCodeId: true },
    });
    expect(updated.every((p) => p.hsCodeId === hsCode.id)).toBe(true);

    // Retrait via null
    const r2 = await bulkUpdateProductAttributes(productIds, { hsCodeId: null });
    expect(r2.updated).toBe(2);
    updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { hsCodeId: true },
    });
    expect(updated.every((p) => p.hsCodeId === null)).toBe(true);
  });

  it("met à jour le pays et la saison ; null = retrait", async () => {
    await bulkUpdateProductAttributes(productIds, {
      manufacturingCountryId: extraCountry.id,
      seasonId: extraSeason.id,
    });
    let updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { manufacturingCountryId: true, seasonId: true },
    });
    for (const p of updated) {
      expect(p.manufacturingCountryId).toBe(extraCountry.id);
      expect(p.seasonId).toBe(extraSeason.id);
    }

    await bulkUpdateProductAttributes(productIds, {
      manufacturingCountryId: null,
      seasonId: null,
    });
    updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { manufacturingCountryId: true, seasonId: true },
    });
    for (const p of updated) {
      expect(p.manufacturingCountryId).toBeNull();
      expect(p.seasonId).toBeNull();
    }
  });

  it("remplace entièrement la composition", async () => {
    const result = await bulkUpdateProductAttributes(productIds, {
      compositions: [
        { compositionId: entities.composition.id, percentage: 70 },
        { compositionId: extraComposition.id, percentage: 30 },
      ],
    });
    expect(result.updated).toBe(2);
    for (const pid of productIds) {
      const comps = await prisma.productComposition.findMany({
        where: { productId: pid },
        select: { compositionId: true, percentage: true },
        orderBy: { percentage: "desc" },
      });
      expect(comps).toHaveLength(2);
      expect(comps[0]).toMatchObject({ compositionId: entities.composition.id, percentage: 70 });
      expect(comps[1]).toMatchObject({ compositionId: extraComposition.id, percentage: 30 });
    }
  });

  it("modifie plusieurs champs en un seul appel", async () => {
    const result = await bulkUpdateProductAttributes(productIds, {
      categoryId: extraCategory.id,
      hsCodeId: hsCode.id,
      isBestSeller: true,
      seasonId: extraSeason.id,
    });
    expect(result.updated).toBe(2);
    const updated = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { categoryId: true, hsCodeId: true, isBestSeller: true, seasonId: true },
    });
    for (const p of updated) {
      expect(p.categoryId).toBe(extraCategory.id);
      expect(p.hsCodeId).toBe(hsCode.id);
      expect(p.isBestSeller).toBe(true);
      expect(p.seasonId).toBe(extraSeason.id);
    }
  });

  // ─────────────────────────────────────────────
  // Cas d'erreur
  // ─────────────────────────────────────────────

  it("rejette quand productIds est vide", async () => {
    await expect(bulkUpdateProductAttributes([], { isBestSeller: true })).rejects.toThrow(
      /Aucun produit/,
    );
  });

  it("rejette quand aucun champ n'est fourni", async () => {
    await expect(bulkUpdateProductAttributes(productIds, {})).rejects.toThrow(
      /Aucune modification/,
    );
  });

  it("rejette une composition dont la somme != 100%", async () => {
    await expect(
      bulkUpdateProductAttributes(productIds, {
        compositions: [
          { compositionId: entities.composition.id, percentage: 50 },
          { compositionId: extraComposition.id, percentage: 30 },
        ],
      }),
    ).rejects.toThrow(/100%/);
  });

  it("rejette un code SH inexistant", async () => {
    await expect(
      bulkUpdateProductAttributes(productIds, { hsCodeId: "fake-id-does-not-exist" }),
    ).rejects.toThrow(/code SH/);
  });

  it("rejette une catégorie inexistante", async () => {
    await expect(
      bulkUpdateProductAttributes(productIds, { categoryId: "fake-id-does-not-exist" }),
    ).rejects.toThrow(/catégorie/);
  });

  it("signale les productIds introuvables sans bloquer les autres", async () => {
    const result = await bulkUpdateProductAttributes(
      [...productIds, "fake-missing-id"],
      { isBestSeller: true },
    );
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/introuvable/);
  });
});
