/**
 * Integration tests: Orders, Cart, Bestseller calculation.
 *
 * Uses REAL database. Tests order creation, status updates, and bestseller ranking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cleanupTestData, seedTestEntities, TEST_PREFIX, prisma } from "./setup";
import { createProduct } from "@/app/actions/admin/products";
import { updateOrderStatus } from "@/app/actions/admin/orders";
import type { ProductInput } from "@/app/actions/admin/products";

describe("Orders & Bestsellers (real DB)", () => {
  let entities: Awaited<ReturnType<typeof seedTestEntities>>;
  let productId1: string;
  let productId2: string;
  let variantId1: string;
  let variantId2: string;
  let userId: string;

  beforeAll(async () => {
    await cleanupTestData();
    entities = await seedTestEntities();

    // Create 2 products
    const prod1 = await createProduct({
      reference: `${TEST_PREFIX}ORD-PROD-001`,
      name: "Produit commande 1",
      description: "",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [{
        colorId: entities.color1.id,
        unitPrice: 10,
        weight: 0.1,
        stock: 100,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],

      }],
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
    } as ProductInput);
    productId1 = prod1.id;
    variantId1 = (await prisma.productColor.findFirst({ where: { productId: productId1 } }))!.id;

    const prod2 = await createProduct({
      reference: `${TEST_PREFIX}ORD-PROD-002`,
      name: "Produit commande 2",
      description: "",
      categoryId: entities.category.id,
      subCategoryIds: [],
      colors: [{
        colorId: entities.color2.id,
        unitPrice: 20,
        weight: 0.2,
        stock: 50,
        isPrimary: true,
        saleType: "UNIT",
        packQuantity: null,
        sizeEntries: [{ sizeId: entities.size.id, quantity: 1 }],

      }],
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
    } as ProductInput);
    productId2 = prod2.id;
    variantId2 = (await prisma.productColor.findFirst({ where: { productId: productId2 } }))!.id;

    // Create test user
    const user = await prisma.user.create({
      data: {
        email: "test_integ_order@test.com",
        password: "$2a$12$fakehash",
        firstName: "Test",
        lastName: "User",
        company: "Test SARL",
        phone: "0600000000",
        siret: `${TEST_PREFIX}SIRET`,
        role: "CLIENT",
        status: "APPROVED",
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ─── Cart operations ───────────────────────────────────────────

  describe("Cart", () => {
    let cartId: string;

    it("should create a cart for user", async () => {
      const cart = await prisma.cart.create({
        data: { userId },
      });
      cartId = cart.id;
      expect(cart.userId).toBe(userId);
    });

    it("should add items to cart", async () => {
      await prisma.cartItem.create({
        data: { cartId, variantId: variantId1, quantity: 3 },
      });
      await prisma.cartItem.create({
        data: { cartId, variantId: variantId2, quantity: 1 },
      });

      const items = await prisma.cartItem.findMany({ where: { cartId } });
      expect(items).toHaveLength(2);
    });

    it("should enforce unique variant per cart", async () => {
      await expect(
        prisma.cartItem.create({
          data: { cartId, variantId: variantId1, quantity: 1 },
        }),
      ).rejects.toThrow();
    });

    it("should update cart item quantity", async () => {
      await prisma.cartItem.updateMany({
        where: { cartId, variantId: variantId1 },
        data: { quantity: 5 },
      });

      const item = await prisma.cartItem.findFirst({
        where: { cartId, variantId: variantId1 },
      });
      expect(item!.quantity).toBe(5);
    });

    it("should remove item from cart", async () => {
      await prisma.cartItem.deleteMany({
        where: { cartId, variantId: variantId2 },
      });

      const items = await prisma.cartItem.findMany({ where: { cartId } });
      expect(items).toHaveLength(1);
    });

    it("should clear cart", async () => {
      await prisma.cartItem.deleteMany({ where: { cartId } });
      const items = await prisma.cartItem.findMany({ where: { cartId } });
      expect(items).toHaveLength(0);
    });
  });

  // ─── Order creation & status ───────────────────────────────────

  describe("Order lifecycle", () => {
    let orderId: string;

    it("should create an order with items", async () => {
      const order = await prisma.order.create({
        data: {
          orderNumber: `${TEST_PREFIX}CMD-001`,
          userId,
          status: "PENDING",
          shipLabel: "Domicile",
          shipFirstName: "Test",
          shipLastName: "User",
          shipAddress1: "10 rue de test",
          shipZipCode: "75001",
          shipCity: "Paris",
          shipCountry: "FR",
          clientCompany: "Test SARL",
          clientEmail: "test@test.com",
          clientPhone: "0600000000",
          clientSiret: `${TEST_PREFIX}SIRET`,
          carrierId: "test-carrier-id",
          carrierName: "Colissimo",
          carrierPrice: 5.99,
          subtotalHT: 50,
          tvaRate: 20,
          tvaAmount: 10,
          totalTTC: 60,
          paymentStatus: "paid",
          items: {
            create: [
              {
                productName: "Produit commande 1",
                productRef: `${TEST_PREFIX}ORD-PROD-001`,
                colorName: `${TEST_PREFIX}Doré`,
                saleType: "UNIT",
                unitPrice: 10,
                quantity: 5,
                lineTotal: 50,
              },
              {
                productName: "Produit commande 2",
                productRef: `${TEST_PREFIX}ORD-PROD-002`,
                colorName: `${TEST_PREFIX}Argenté`,
                saleType: "UNIT",
                unitPrice: 20,
                quantity: 2,
                lineTotal: 40,
              },
            ],
          },
        },
      });
      orderId = order.id;

      expect(order.status).toBe("PENDING");
      expect(Number(order.totalTTC)).toBe(60);
    });

    it("should update order status PENDING → PROCESSING", async () => {
      await updateOrderStatus(orderId, "PROCESSING");
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe("PROCESSING");
    });

    it("should update order status PROCESSING → SHIPPED", async () => {
      await updateOrderStatus(orderId, "SHIPPED");
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe("SHIPPED");
    });

    it("should update order status SHIPPED → DELIVERED", async () => {
      await updateOrderStatus(orderId, "DELIVERED");
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order!.status).toBe("DELIVERED");
    });

    it("should reject invalid status", async () => {
      await expect(updateOrderStatus(orderId, "INVALID_STATUS")).rejects.toThrow();
    });
  });

  // ─── Bestseller ranking ────────────────────────────────────────

  describe("Bestseller calculation", () => {
    it("should create a second order for bestseller ranking", async () => {
      await prisma.order.create({
        data: {
          orderNumber: `${TEST_PREFIX}CMD-002`,
          userId,
          status: "DELIVERED",
          shipLabel: "Domicile",
          shipFirstName: "Test",
          shipLastName: "User",
          shipAddress1: "10 rue de test",
          shipZipCode: "75001",
          shipCity: "Paris",
          shipCountry: "FR",
          clientCompany: "Test SARL",
          clientEmail: "test@test.com",
          clientPhone: "0600000000",
          clientSiret: `${TEST_PREFIX}SIRET2`,
          carrierId: "test-carrier-id",
          carrierName: "Colissimo",
          carrierPrice: 5.99,
          subtotalHT: 100,
          tvaRate: 20,
          tvaAmount: 20,
          totalTTC: 120,
          paymentStatus: "paid",
          items: {
            create: [
              {
                productName: "Produit commande 1",
                productRef: `${TEST_PREFIX}ORD-PROD-001`,
                colorName: "Doré",
                saleType: "UNIT",
                unitPrice: 10,
                quantity: 10, // 10 more units
                lineTotal: 100,
              },
            ],
          },
        },
      });
    });

    it("should rank products by total quantity sold", async () => {
      const stats = await prisma.orderItem.groupBy({
        by: ["productRef"],
        where: { productRef: { startsWith: TEST_PREFIX } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
      });

      expect(stats.length).toBeGreaterThanOrEqual(2);

      // Prod 1: 5 + 10 = 15 units
      const prod1Stats = stats.find((s) => s.productRef === `${TEST_PREFIX}ORD-PROD-001`);
      expect(prod1Stats?._sum.quantity).toBe(15);

      // Prod 2: 2 units
      const prod2Stats = stats.find((s) => s.productRef === `${TEST_PREFIX}ORD-PROD-002`);
      expect(prod2Stats?._sum.quantity).toBe(2);

      // Prod 1 should be ranked higher (more sold)
      const prod1Index = stats.findIndex((s) => s.productRef === `${TEST_PREFIX}ORD-PROD-001`);
      const prod2Index = stats.findIndex((s) => s.productRef === `${TEST_PREFIX}ORD-PROD-002`);
      expect(prod1Index).toBeLessThan(prod2Index);
    });
  });

  // ─── Stock validation ──────────────────────────────────────────

  describe("Stock operations", () => {
    it("should decrement stock on variant", async () => {
      const before = await prisma.productColor.findUnique({ where: { id: variantId1 } });
      const originalStock = before!.stock;

      await prisma.productColor.update({
        where: { id: variantId1 },
        data: { stock: { decrement: 5 } },
      });

      const after = await prisma.productColor.findUnique({ where: { id: variantId1 } });
      expect(after!.stock).toBe(originalStock - 5);
    });

    it("should set stock to zero", async () => {
      await prisma.productColor.update({
        where: { id: variantId1 },
        data: { stock: 0 },
      });

      const variant = await prisma.productColor.findUnique({ where: { id: variantId1 } });
      expect(variant!.stock).toBe(0);
    });

    it("should restock variant", async () => {
      await prisma.productColor.update({
        where: { id: variantId1 },
        data: { stock: 50 },
      });

      const variant = await prisma.productColor.findUnique({ where: { id: variantId1 } });
      expect(variant!.stock).toBe(50);
    });
  });
});
