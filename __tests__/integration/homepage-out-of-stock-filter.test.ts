/**
 * Integration test: sections carrousel de la page d'accueil excluent les produits en rupture.
 *
 * Regle metier : un produit est masque des sections « Nouveautes / Best-sellers /
 * Mis en avant » des que toutes ses couleurs actives ont stock = 0. Une seule couleur
 * en stock suffit a le garder. Les couleurs disabled=true ne comptent pas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { fetchCarouselProducts } from "@/lib/product-display";

describe("Homepage carousels exclude out-of-stock products", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let inStockId: string;
  let outOfStockId: string;
  let mixedStockId: string;
  let onlyDisabledStockId: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    // Produit A : 1 couleur active, stock > 0 → doit apparaitre.
    const inStock = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}STK-A`,
        name: "In stock",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    inStockId = inStock.id;
    await prisma.productColor.create({
      data: {
        productId: inStockId,
        colorId: entities.color1.id,
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        saleType: "UNIT",
        disabled: false,
      },
    });

    // Produit B : 1 couleur active mais stock = 0 → doit etre exclu.
    const outOfStock = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}STK-B`,
        name: "Out of stock",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    outOfStockId = outOfStock.id;
    await prisma.productColor.create({
      data: {
        productId: outOfStockId,
        colorId: entities.color1.id,
        unitPrice: 10,
        weight: 0.05,
        stock: 0,
        saleType: "UNIT",
        disabled: false,
      },
    });

    // Produit C : 2 couleurs, l'une a 0, l'autre a 3 → doit apparaitre.
    const mixed = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}STK-C`,
        name: "Mixed stock",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    mixedStockId = mixed.id;
    await prisma.productColor.createMany({
      data: [
        {
          productId: mixedStockId,
          colorId: entities.color1.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 0,
          saleType: "UNIT",
          disabled: false,
        },
        {
          productId: mixedStockId,
          colorId: entities.color2.id,
          unitPrice: 10,
          weight: 0.05,
          stock: 3,
          saleType: "UNIT",
          disabled: false,
        },
      ],
    });

    // Produit D : 1 couleur en stock mais disabled=true → doit etre exclu
    // (aucune couleur active en stock du point de vue vitrine).
    const onlyDisabled = await prisma.product.create({
      data: {
        reference: `${TEST_PREFIX}STK-D`,
        name: "Only disabled stock",
        description: "",
        categoryId: entities.category.id,
        countryIsoCode: entities.country.id,
        seasonId: entities.season.id,
        status: "ONLINE",
      },
    });
    onlyDisabledStockId = onlyDisabled.id;
    await prisma.productColor.create({
      data: {
        productId: onlyDisabledStockId,
        colorId: entities.color1.id,
        unitPrice: 10,
        weight: 0.05,
        stock: 5,
        saleType: "UNIT",
        disabled: true,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("« Nouveautes » (new) : garde le produit avec stock, exclut celui en rupture", async () => {
    const products = await fetchCarouselProducts({
      id: "test-new",
      type: "new",
      title: "Nouveautes",
      quantity: 100,
      visible: true,
    });
    const ids = products.map((p) => p.id);
    expect(ids).toContain(inStockId);
    expect(ids).toContain(mixedStockId);
    expect(ids).not.toContain(outOfStockId);
    expect(ids).not.toContain(onlyDisabledStockId);
  });

  it("« Category » : meme filtre stock applique", async () => {
    const products = await fetchCarouselProducts({
      id: "test-cat",
      type: "category",
      title: "Cat",
      quantity: 100,
      visible: true,
      categoryId: entities.category.id,
    });
    const ids = products.map((p) => p.id);
    expect(ids).toContain(inStockId);
    expect(ids).toContain(mixedStockId);
    expect(ids).not.toContain(outOfStockId);
    expect(ids).not.toContain(onlyDisabledStockId);
  });

  it("« Custom » (produits choisis manuellement) : exclut aussi ceux en rupture", async () => {
    const products = await fetchCarouselProducts({
      id: "test-custom",
      type: "custom",
      title: "Custom",
      quantity: 100,
      visible: true,
      productIds: [inStockId, outOfStockId, mixedStockId, onlyDisabledStockId],
    });
    const ids = products.map((p) => p.id);
    expect(ids).toContain(inStockId);
    expect(ids).toContain(mixedStockId);
    expect(ids).not.toContain(outOfStockId);
    expect(ids).not.toContain(onlyDisabledStockId);
  });
});
