/**
 * Integration tests: Entity CRUD (Color, Category, Composition, Size, Season, Country, Collection)
 *
 * Uses REAL database. All test data prefixed with TEST_INTEG_ and cleaned up.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, TEST_PREFIX, prisma } from "./setup";

describe("Entity CRUD (real DB)", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ─── Color CRUD ────────────────────────────────────────────────

  describe("Color", () => {
    let colorId: string;

    it("should create a color", async () => {
      const color = await prisma.color.create({
        data: { name: `${TEST_PREFIX}Bleu`, hex: "#0000FF" },
      });
      colorId = color.id;

      expect(color.name).toBe(`${TEST_PREFIX}Bleu`);
      expect(color.hex).toBe("#0000FF");
      expect(color.patternImage).toBeNull();
    });

    it("should enforce unique name", async () => {
      await expect(
        prisma.color.create({ data: { name: `${TEST_PREFIX}Bleu`, hex: "#0000EE" } }),
      ).rejects.toThrow();
    });

    it("should update color hex and patternImage", async () => {
      const updated = await prisma.color.update({
        where: { id: colorId },
        data: { hex: null, patternImage: "/uploads/patterns/blue.webp" },
      });
      expect(updated.hex).toBeNull();
      expect(updated.patternImage).toBe("/uploads/patterns/blue.webp");
    });

    it("should create color translations", async () => {
      await prisma.colorTranslation.create({
        data: { colorId, locale: "en", name: "Blue" },
      });
      await prisma.colorTranslation.create({
        data: { colorId, locale: "de", name: "Blau" },
      });

      const translations = await prisma.colorTranslation.findMany({
        where: { colorId },
        orderBy: { locale: "asc" },
      });
      expect(translations).toHaveLength(2);
      expect(translations[0].locale).toBe("de");
      expect(translations[1].locale).toBe("en");
    });

    it("should delete color (if unused)", async () => {
      // Delete translations first
      await prisma.colorTranslation.deleteMany({ where: { colorId } });
      await prisma.color.delete({ where: { id: colorId } });

      const found = await prisma.color.findUnique({ where: { id: colorId } });
      expect(found).toBeNull();
    });
  });

  // ─── Category CRUD ─────────────────────────────────────────────

  describe("Category", () => {
    let categoryId: string;
    let subCategoryId: string;

    it("should create a category with slug", async () => {
      const cat = await prisma.category.create({
        data: { name: `${TEST_PREFIX}Colliers`, slug: `${TEST_PREFIX}colliers` },
      });
      categoryId = cat.id;

      expect(cat.name).toBe(`${TEST_PREFIX}Colliers`);
      expect(cat.slug).toBe(`${TEST_PREFIX}colliers`);
    });

    it("should create a sub-category", async () => {
      const subCat = await prisma.subCategory.create({
        data: {
          name: `${TEST_PREFIX}Colliers ras de cou`,
          slug: `${TEST_PREFIX}colliers-ras-de-cou`,
          categoryId,
        },
      });
      subCategoryId = subCat.id;

      expect(subCat.categoryId).toBe(categoryId);
    });

    it("should enforce unique sub-category per category", async () => {
      await expect(
        prisma.subCategory.create({
          data: {
            name: `${TEST_PREFIX}Colliers ras de cou`,
            slug: `${TEST_PREFIX}colliers-ras-de-cou-2`,
            categoryId,
          },
        }),
      ).rejects.toThrow();
    });

    it("should link size to category", async () => {
      const size = await prisma.size.create({
        data: { name: `${TEST_PREFIX}XL`, position: 10 },
      });

      await prisma.sizeCategoryLink.create({
        data: { sizeId: size.id, categoryId },
      });

      const links = await prisma.sizeCategoryLink.findMany({
        where: { categoryId },
      });
      expect(links.length).toBeGreaterThanOrEqual(1);
    });

    it("should update category PFS mapping", async () => {
      const updated = await prisma.category.update({
        where: { id: categoryId },
        data: { pfsCategoryId: "pfs-cat-123", pfsGender: "WOMAN", pfsFamilyId: "pfs-fam-1" },
      });

      expect(updated.pfsCategoryId).toBe("pfs-cat-123");
      expect(updated.pfsGender).toBe("WOMAN");
    });

    it("should delete sub-category then category", async () => {
      await prisma.subCategory.delete({ where: { id: subCategoryId } });
      await prisma.sizeCategoryLink.deleteMany({ where: { categoryId } });
      await prisma.category.delete({ where: { id: categoryId } });

      const found = await prisma.category.findUnique({ where: { id: categoryId } });
      expect(found).toBeNull();
    });
  });

  // ─── Composition CRUD ──────────────────────────────────────────

  describe("Composition", () => {
    let compositionId: string;

    it("should create a composition", async () => {
      const comp = await prisma.composition.create({
        data: { name: `${TEST_PREFIX}Laiton`, pfsCompositionRef: "LAITON" },
      });
      compositionId = comp.id;

      expect(comp.pfsCompositionRef).toBe("LAITON");
    });

    it("should enforce unique name", async () => {
      await expect(
        prisma.composition.create({ data: { name: `${TEST_PREFIX}Laiton` } }),
      ).rejects.toThrow();
    });

    it("should update PFS ref", async () => {
      const updated = await prisma.composition.update({
        where: { id: compositionId },
        data: { pfsCompositionRef: "BRASS" },
      });
      expect(updated.pfsCompositionRef).toBe("BRASS");
    });

    it("should delete composition", async () => {
      await prisma.composition.delete({ where: { id: compositionId } });
      const found = await prisma.composition.findUnique({ where: { id: compositionId } });
      expect(found).toBeNull();
    });
  });

  // ─── Size CRUD ─────────────────────────────────────────────────

  describe("Size", () => {
    let sizeId: string;

    it("should create a size with position", async () => {
      const size = await prisma.size.create({
        data: { name: `${TEST_PREFIX}XXL`, position: 99 },
      });
      sizeId = size.id;

      expect(size.position).toBe(99);
    });

    it("should create PFS size mapping", async () => {
      await prisma.sizePfsMapping.create({
        data: { sizeId, pfsSizeRef: "XXL" },
      });

      const mappings = await prisma.sizePfsMapping.findMany({
        where: { sizeId },
      });
      expect(mappings).toHaveLength(1);
      expect(mappings[0].pfsSizeRef).toBe("XXL");
    });

    it("should support multiple PFS mappings per size", async () => {
      await prisma.sizePfsMapping.create({
        data: { sizeId, pfsSizeRef: "XXXL" },
      });

      const mappings = await prisma.sizePfsMapping.findMany({
        where: { sizeId },
      });
      expect(mappings).toHaveLength(2);
    });

    it("should delete size and its mappings", async () => {
      await prisma.sizePfsMapping.deleteMany({ where: { sizeId } });
      await prisma.size.delete({ where: { id: sizeId } });
      const found = await prisma.size.findUnique({ where: { id: sizeId } });
      expect(found).toBeNull();
    });
  });

  // ─── Season CRUD ───────────────────────────────────────────────

  describe("Season", () => {
    let seasonId: string;

    it("should create a season with PFS ref", async () => {
      const season = await prisma.season.create({
        data: { name: `${TEST_PREFIX}AH2026`, pfsRef: `${TEST_PREFIX}AH2026` },
      });
      seasonId = season.id;

      expect(season.pfsRef).toBe(`${TEST_PREFIX}AH2026`);
    });

    it("should enforce unique pfsRef", async () => {
      await expect(
        prisma.season.create({
          data: { name: `${TEST_PREFIX}AH2026bis`, pfsRef: `${TEST_PREFIX}AH2026` },
        }),
      ).rejects.toThrow();
    });

    it("should delete season", async () => {
      await prisma.season.delete({ where: { id: seasonId } });
      const found = await prisma.season.findUnique({ where: { id: seasonId } });
      expect(found).toBeNull();
    });
  });

  // ─── ManufacturingCountry CRUD ─────────────────────────────────

  describe("ManufacturingCountry", () => {
    let countryId: string;

    it("should create a country", async () => {
      const country = await prisma.manufacturingCountry.create({
        data: {
          name: `${TEST_PREFIX}Turquie`,
          isoCode: `${TEST_PREFIX}TR`,
          pfsCountryRef: `${TEST_PREFIX}TR`,
        },
      });
      countryId = country.id;

      expect(country.isoCode).toBe(`${TEST_PREFIX}TR`);
    });

    it("should delete country", async () => {
      await prisma.manufacturingCountry.delete({ where: { id: countryId } });
      const found = await prisma.manufacturingCountry.findUnique({ where: { id: countryId } });
      expect(found).toBeNull();
    });
  });

  // ─── Collection CRUD ───────────────────────────────────────────

  describe("Collection", () => {
    let collectionId: string;

    it("should create a collection", async () => {
      const col = await prisma.collection.create({
        data: { name: `${TEST_PREFIX}Été 2026` },
      });
      collectionId = col.id;

      expect(col.name).toBe(`${TEST_PREFIX}Été 2026`);
    });

    it("should create translations", async () => {
      await prisma.collectionTranslation.create({
        data: { collectionId, locale: "en", name: "Summer 2026" },
      });

      const t = await prisma.collectionTranslation.findFirst({
        where: { collectionId, locale: "en" },
      });
      expect(t?.name).toBe("Summer 2026");
    });

    it("should delete collection", async () => {
      await prisma.collectionTranslation.deleteMany({ where: { collectionId } });
      await prisma.collection.delete({ where: { id: collectionId } });
      const found = await prisma.collection.findUnique({ where: { id: collectionId } });
      expect(found).toBeNull();
    });
  });
});
