/**
 * Integration test : checkProductReferenceAvailable.
 *
 * Pré-check non-throw appelé par le formulaire avant createProduct /
 * updateProduct pour afficher à l'utilisatrice un message clair plutôt que
 * laisser remonter une exception masquée par Next.js en production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { checkProductReferenceAvailable, createProduct } from "@/app/actions/admin/products";
import type { ProductInput } from "@/app/actions/admin/products";

describe("checkProductReferenceAvailable (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  function buildInput(reference: string): ProductInput {
    return {
      reference,
      name: "Produit test",
      description: "",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [
        {
          colorId: entities.color1.id,
          unitPrice: 1,
          weight: 0.1,
          stock: 1,
          isPrimary: true,
          saleType: "UNIT",
          packQuantity: null,
          sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],
        },
      ],
      compositions: [],
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
      manufacturingCountryId: entities.country.id,
      seasonId: entities.season.id,
    };
  }

  it("returns available=true when reference is free", async () => {
    const res = await checkProductReferenceAvailable(`${TEST_PREFIX}REFCHECK-FREE`);
    expect(res.available).toBe(true);
  });

  it("returns available=false when reference is taken", async () => {
    const taken = `${TEST_PREFIX}REFCHECK-TAKEN`;
    await createProduct(buildInput(taken));

    const res = await checkProductReferenceAvailable(taken);
    expect(res.available).toBe(false);
  });

  it("normalises case and trims whitespace before checking", async () => {
    const taken = `${TEST_PREFIX}REFCHECK-CASE`;
    await createProduct(buildInput(taken));

    const res = await checkProductReferenceAvailable(`  ${taken.toLowerCase()}  `);
    expect(res.available).toBe(false);
  });

  it("returns available=true when the reference belongs to the excluded product", async () => {
    const taken = `${TEST_PREFIX}REFCHECK-SELF`;
    const { id } = await createProduct(buildInput(taken));

    const res = await checkProductReferenceAvailable(taken, id);
    expect(res.available).toBe(true);
  });

  it("returns available=false on empty input (no silent pass-through)", async () => {
    const res = await checkProductReferenceAvailable("   ");
    expect(res.available).toBe(false);
  });

  it("does not create or mutate the product when called", async () => {
    const ref = `${TEST_PREFIX}REFCHECK-NOWRITE`;
    await checkProductReferenceAvailable(ref);
    const found = await prisma.product.findFirst({ where: { reference: ref } });
    expect(found).toBeNull();
  });
});
