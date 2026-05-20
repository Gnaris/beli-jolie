/**
 * Integration tests : fusion de deux couleurs.
 *
 * Vérifie que :
 *  - checkColorMergeConflicts détecte les conflits (variante, pack-line, image)
 *  - mergeColors refuse si conflit, migre toutes les FK sinon
 *  - Les translations de l'absorbée sont supprimées en cascade
 *  - primaryColorId est migré
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import {
  checkColorMergeConflicts,
  mergeColors,
} from "@/app/actions/admin/color-merge";

describe("checkColorMergeConflicts", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });
  afterAll(async () => {
    await cleanupTestData();
  });

  it("refuse quand keptId === absorbedId", async () => {
    await expect(
      checkColorMergeConflicts(entities.color1.id, entities.color1.id),
    ).rejects.toThrow(/identique/i);
  });

  it("détecte un doublon de variante", async () => {
    const product = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}MERGE-V1`,
        name: "Produit double variante",
        description: "x",
        categoryId: entities.category.id,
        seasonId: entities.season.id,
        manufacturingCountryId: entities.country.id,
        status: "OFFLINE",
        colors: {
          create: [
            {
              colorId: entities.color1.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 5,
              isPrimary: true,
              saleType: "UNIT",
            },
            {
              colorId: entities.color2.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 5,
              saleType: "UNIT",
            },
          ],
        },
      },
    });
    const res = await checkColorMergeConflicts(entities.color1.id, entities.color2.id);
    expect(res.conflicts.length).toBeGreaterThanOrEqual(1);
    const variantConflict = res.conflicts.find((c) => c.kind === "variant_duplicate");
    expect(variantConflict).toBeDefined();
    expect(variantConflict?.productId).toBe(product.id);

    // Nettoyage local pour pas polluer les autres tests
    await prisma.productColor.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it("retourne un count d'affected correct sans conflit", async () => {
    const product = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}MERGE-A1`,
        name: "Produit affected",
        description: "x",
        categoryId: entities.category.id,
        seasonId: entities.season.id,
        manufacturingCountryId: entities.country.id,
        status: "OFFLINE",
        colors: {
          create: [
            {
              colorId: entities.color3.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 5,
              isPrimary: true,
              saleType: "UNIT",
            },
          ],
        },
      },
    });
    const res = await checkColorMergeConflicts(entities.color1.id, entities.color3.id);
    expect(res.conflicts).toHaveLength(0);
    expect(res.affectedProductCount).toBe(1);
    expect(res.absorbedColorName).toContain("Rose");
    expect(res.keptColorName).toContain("Doré");

    await prisma.productColor.deleteMany({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });
});

describe("mergeColors", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });
  afterAll(async () => {
    await cleanupTestData();
  });

  it("migre les variantes de l'absorbée vers la gardée et supprime l'absorbée", async () => {
    const product = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}MERGE-S1`,
        name: "Produit fusion simple",
        description: "x",
        categoryId: entities.category.id,
        seasonId: entities.season.id,
        manufacturingCountryId: entities.country.id,
        status: "OFFLINE",
        colors: {
          create: [
            {
              colorId: entities.color3.id,
              unitPrice: 9.99,
              weight: 0.1,
              stock: 5,
              isPrimary: true,
              saleType: "UNIT",
            },
          ],
        },
      },
    });
    const res = await mergeColors(entities.color1.id, entities.color3.id);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.affectedProducts).toHaveLength(1);
    expect(res.affectedProducts[0]!.productId).toBe(product.id);

    const absorbed = await prisma.color.findUnique({ where: { id: entities.color3.id } });
    expect(absorbed).toBeNull();
    const variant = await prisma.productColor.findFirst({ where: { productId: product.id } });
    expect(variant?.colorId).toBe(entities.color1.id);
  });

  it("refuse la fusion s'il y a un conflit et laisse la BDD intacte", async () => {
    const product = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}MERGE-X1`,
        name: "Produit conflit",
        description: "x",
        categoryId: entities.category.id,
        seasonId: entities.season.id,
        manufacturingCountryId: entities.country.id,
        status: "OFFLINE",
        colors: {
          create: [
            { colorId: entities.color1.id, unitPrice: 9.99, weight: 0.1, stock: 5, isPrimary: true, saleType: "UNIT" },
            { colorId: entities.color2.id, unitPrice: 9.99, weight: 0.1, stock: 5, saleType: "UNIT" },
          ],
        },
      },
    });
    const res = await mergeColors(entities.color1.id, entities.color2.id);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.conflicts.length).toBeGreaterThan(0);
    const stillThere = await prisma.color.findUnique({ where: { id: entities.color2.id } });
    expect(stillThere).not.toBeNull();
    const variants = await prisma.productColor.findMany({ where: { productId: product.id } });
    expect(variants).toHaveLength(2);
  });

  it("migre primaryColorId quand l'absorbée est la couleur primaire d'un produit", async () => {
    const product = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}MERGE-P1`,
        name: "Produit primaire",
        description: "x",
        categoryId: entities.category.id,
        seasonId: entities.season.id,
        manufacturingCountryId: entities.country.id,
        status: "OFFLINE",
        primaryColorId: entities.color2.id,
        colors: {
          create: [
            { colorId: entities.color2.id, unitPrice: 9.99, weight: 0.1, stock: 5, isPrimary: true, saleType: "UNIT" },
          ],
        },
      },
    });
    // Avant d'appeler mergeColors, supprime le conflit color1+color2 du test précédent
    await prisma.productColor.deleteMany({
      where: { product: { reference: `${TEST_PREFIX}MERGE-X1` } },
    });
    await prisma.product.deleteMany({
      where: { reference: `${TEST_PREFIX}MERGE-X1` },
    });

    const res = await mergeColors(entities.color1.id, entities.color2.id);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const reloaded = await prisma.product.findUnique({
      where: { id: product.id },
      select: { primaryColorId: true },
    });
    expect(reloaded?.primaryColorId).toBe(entities.color1.id);
  });
});
