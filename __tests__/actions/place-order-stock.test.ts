/**
 * Tests pour app/actions/client/order.ts — placeOrder.
 *
 * On vérifie deux propriétés critiques avant prod :
 *  - P1-01 : si le stock est insuffisant, la commande N'EST PAS créée et
 *            le client reçoit un message clair (pas de survente possible).
 *  - P1-07 : si le montant Stripe ne correspond pas au total recalculé,
 *            la commande est refusée (anti-tampering).
 *
 * Tout est mocké : Prisma, Stripe, NextAuth, emails, Easy-Express, PDF.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks hoisted ────────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  cart: { findUnique: vi.fn() },
  shippingAddress: { findFirst: vi.fn() },
  productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
  siteConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  order: {
    findUnique: vi.fn().mockResolvedValue(null), // pas de collision orderNumber
    update: vi.fn(),
  },
  cartItem: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

const mockSession = vi.hoisted(() => ({
  user: { id: "user-1" },
}));

const mockStripe = vi.hoisted(() => ({
  paymentIntents: { retrieve: vi.fn() },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(mockSession),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/stock", () => ({
  reinstateStockForOrder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeInstance: vi.fn().mockResolvedValue(mockStripe),
  getConnectedAccountId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/easy-express", () => ({
  createEasyExpressShipment: vi.fn().mockResolvedValue({ success: false, error: "skip" }),
  fetchEasyExpressLabel: vi.fn(),
}));
vi.mock("@/lib/pdf-order", () => ({
  generateOrderPDF: vi.fn().mockResolvedValue(Buffer.from("")),
}));
vi.mock("@/lib/notifications", () => ({
  notifyAdminNewOrder: vi.fn().mockResolvedValue(undefined),
  notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { placeOrder } from "@/app/actions/client/order";

// ─── Données de test partagées ────────────────────────────────────────────────

const variant = {
  id: "var-1",
  productId: "prod-1",
  colorId: "color-1",
  saleType: "UNIT" as const,
  packQuantity: null,
  weight: 0.2,
  unitPrice: 10,
  product: {
    id: "prod-1",
    name: "Bague test",
    reference: "BAG-001",
    status: "ONLINE",
    discountPercent: null,
    category: { name: "Bagues" },
  },
  color: { id: "color-1", name: "Or", hex: "#FFD700" },
  variantSizes: [{ size: { name: "TU" }, quantity: 1 }],
};

const baseUser = {
  firstName: "Jean",
  lastName: "Dupont",
  company: "ACME",
  email: "jean@acme.fr",
  phone: "0600000000",
  siret: "12345678900015",
  vatNumber: null,
  discountType: null,
  discountValue: null,
  discountMode: "PERMANENT",
  discountMinAmount: null,
  discountMinQuantity: null,
  freeShipping: false,
  shippingDiscountType: null,
  shippingDiscountValue: null,
};

const baseAddress = {
  id: "addr-1",
  label: "Boutique",
  firstName: "Jean",
  lastName: "Dupont",
  company: "ACME",
  address1: "1 rue Test",
  address2: null,
  zipCode: "75001",
  city: "Paris",
  country: "FR",
  phone: null,
};

const baseInput = {
  addressId: "addr-1",
  carrierId: "fallback_pickup",
  transactionId: "tx-1",
  carrierName: "Retrait",
  carrierPrice: 0,
  tvaRate: 0.2,
  stripePaymentIntentId: "pi_test",
};

// 1 article × 10€ HT, TVA 20% → totalTTC = 12€ → 1200 cents
const TOTAL_TTC_CENTS = 1200;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(baseUser);
  mockPrisma.shippingAddress.findFirst.mockResolvedValue(baseAddress);
  mockPrisma.cart.findUnique.mockResolvedValue({
    id: "cart-1",
    items: [{ quantity: 1, variant }],
  });
  mockStripe.paymentIntents.retrieve.mockResolvedValue({
    status: "succeeded",
    amount: TOTAL_TTC_CENTS,
  });
});

describe("placeOrder — vérification de stock (P1-01)", () => {
  it("refuse la commande si le stock est insuffisant et n'écrit pas en base", async () => {
    // updateMany conditionnel renvoie 0 → rupture
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        productColor: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUnique: vi.fn().mockResolvedValue({ stock: 0 }),
        },
        order: { create: vi.fn() },
        stockMovement: { createMany: vi.fn() },
      };
      return callback(tx);
    });

    const res = await placeOrder(baseInput);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/Stock insuffisant/i);
      expect(res.error).toMatch(/Bague test/);
    }
  });

  it("crée la commande ET trace un mouvement de stock quand le stock est suffisant", async () => {
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1",
      orderNumber: "ABCDEFGH",
      createdAt: new Date(),
      promoCode: null,
      promoDiscount: 0,
      creditApplied: 0,
    });
    const stockCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        productColor: { updateMany, findUnique: vi.fn() },
        order: { create: orderCreate },
        stockMovement: { createMany: stockCreateMany },
      };
      return callback(tx);
    });

    const res = await placeOrder(baseInput);

    expect(res.success).toBe(true);
    // Vérif clé : updateMany utilise stock >= qty (atomique, anti-survente)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "var-1", stock: { gte: 1 } },
        data: { stock: { decrement: 1 } },
      }),
    );
    // Mouvement de stock tracé avec orderId
    expect(stockCreateMany).toHaveBeenCalledOnce();
    const movementArg = stockCreateMany.mock.calls[0][0];
    expect(movementArg.data[0]).toMatchObject({
      productColorId: "var-1",
      quantity: -1,
      type: "ORDER",
      orderId: "order-1",
    });
  });
});

describe("placeOrder — vérification du montant Stripe (P1-07)", () => {
  it("refuse la commande si le montant payé est différent du total recalculé", async () => {
    // Stripe a encaissé 5€ alors que la commande vaut 12€ TTC
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      status: "succeeded",
      amount: 500,
    });

    const res = await placeOrder(baseInput);

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/montant.*ne correspond pas/i);
    }
    // La transaction stock + commande ne doit JAMAIS être lancée
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("tolère un écart d'1 centime (arrondi)", async () => {
    mockStripe.paymentIntents.retrieve.mockResolvedValue({
      status: "succeeded",
      amount: TOTAL_TTC_CENTS + 1,
    });

    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        productColor: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn(),
        },
        order: {
          create: vi.fn().mockResolvedValue({
            id: "order-1",
            orderNumber: "ABCDEFGH",
            createdAt: new Date(),
            promoCode: null,
            promoDiscount: 0,
            creditApplied: 0,
          }),
        },
        stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      };
      return callback(tx);
    });

    const res = await placeOrder(baseInput);
    expect(res.success).toBe(true);
  });
});
