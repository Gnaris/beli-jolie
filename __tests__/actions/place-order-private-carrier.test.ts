/**
 * Tests pour app/actions/client/order.ts — mode "Transporteur Privé".
 *
 * Vérifie :
 *  - Quand carrierId === "private_carrier" : carrierPrice forcé à 0,
 *    Easy-Express N'EST PAS appelé, les champs privateCarrier* sont persistés
 *    sur la commande.
 *  - La TVA reste calculée selon l'adresse de livraison (20 % FR).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  cart: { findUnique: vi.fn() },
  shippingAddress: { findFirst: vi.fn() },
  productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
  siteConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  order: {
    findUnique: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
  },
  cartItem: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

const mockSession = vi.hoisted(() => ({ user: { id: "user-1" } }));

const mockStripe = vi.hoisted(() => ({
  paymentIntents: { retrieve: vi.fn() },
}));

const mockEasyExpress = vi.hoisted(() => ({
  createEasyExpressShipment: vi.fn().mockResolvedValue({ success: false, error: "skip" }),
  fetchEasyExpressLabel: vi.fn(),
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
}));
vi.mock("@/lib/easy-express", () => mockEasyExpress);
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
    name: "Test",
    reference: "T-001",
    status: "ONLINE",
    discountPercent: null,
    category: { name: "Cat" },
  },
  color: { id: "color-1", name: "Or", hex: "#FFD700" },
  variantSizes: [{ size: { name: "TU" }, quantity: 1 }],
  packLines: [],
};

const baseUser = {
  firstName: "Jean", lastName: "Dupont", company: "ACME",
  email: "jean@acme.fr", phone: "0600000000", siret: "12345678900015",
  vatNumber: null, vatExempt: false, addressCountry: "FR",
  discountType: null, discountValue: null, discountMode: "PERMANENT",
  discountMinAmount: null, discountMinQuantity: null, freeShipping: false,
  shippingDiscountType: null, shippingDiscountValue: null,
};

const baseAddress = {
  id: "addr-1", label: "Boutique",
  firstName: "Jean", lastName: "Dupont", company: "ACME",
  address1: "1 rue Test", address2: null,
  zipCode: "75001", city: "Paris", country: "FR", phone: null,
};

// 1 article × 10€ HT × TVA 20% = 12€ TTC, frais transporteur = 0
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

describe("placeOrder — Transporteur Privé", () => {
  it("force carrierPrice à 0 même si l'input client tente d'envoyer un prix", async () => {
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1", orderNumber: "ABCDEFGH", createdAt: new Date(),
      promoCode: null, promoDiscount: 0, creditApplied: 0,
    });
    mockPrisma.$transaction.mockImplementation(async (cb) =>
      cb({
        productColor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
        order: { create: orderCreate },
        stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    const res = await placeOrder({
      addressId:             "addr-1",
      carrierId:             "private_carrier",
      transactionId:         "tx-private",
      carrierName:           "Transporteur privé",
      carrierPrice:          50, // tentative malicieuse
      stripePaymentIntentId: "pi_test",
      privateCarrierEmail:   "transport@client.com",
      privateCarrierPhone:   "0612345678",
    });

    expect(res.success).toBe(true);
    expect(orderCreate).toHaveBeenCalledOnce();
    const createArg = orderCreate.mock.calls[0][0].data;
    expect(Number(createArg.carrierPrice)).toBe(0);
  });

  it("persiste les coordonnées du transporteur sur la commande", async () => {
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1", orderNumber: "ABCDEFGH", createdAt: new Date(),
      promoCode: null, promoDiscount: 0, creditApplied: 0,
    });
    mockPrisma.$transaction.mockImplementation(async (cb) =>
      cb({
        productColor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
        order: { create: orderCreate },
        stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await placeOrder({
      addressId:             "addr-1",
      carrierId:             "private_carrier",
      transactionId:         "",
      carrierName:           "Transporteur privé",
      carrierPrice:          0,
      stripePaymentIntentId: "pi_test",
      privateCarrierEmail:   "transport@client.com",
      privateCarrierPhone:   "0612345678",
    });

    const createArg = orderCreate.mock.calls[0][0].data;
    expect(createArg.privateCarrierEmail).toBe("transport@client.com");
    expect(createArg.privateCarrierPhone).toBe("0612345678");
    expect(createArg.privateCarrierBordereau).toBeNull();
  });

  it("persiste le bordereau quand fourni à la place des coordonnées", async () => {
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1", orderNumber: "ABCDEFGH", createdAt: new Date(),
      promoCode: null, promoDiscount: 0, creditApplied: 0,
    });
    mockPrisma.$transaction.mockImplementation(async (cb) =>
      cb({
        productColor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
        order: { create: orderCreate },
        stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await placeOrder({
      addressId:                "addr-1",
      carrierId:                "private_carrier",
      transactionId:            "",
      carrierName:              "Transporteur privé",
      carrierPrice:             0,
      stripePaymentIntentId:    "pi_test",
      privateCarrierBordereau:  "/uploads/bordereaux/user-42-abcdef.pdf",
    });

    const createArg = orderCreate.mock.calls[0][0].data;
    expect(createArg.privateCarrierBordereau).toBe(
      "/uploads/bordereaux/user-42-abcdef.pdf",
    );
    expect(createArg.privateCarrierEmail).toBeNull();
    expect(createArg.privateCarrierPhone).toBeNull();
  });

  it("n'appelle PAS Easy-Express en mode transporteur privé", async () => {
    mockPrisma.$transaction.mockImplementation(async (cb) =>
      cb({
        productColor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
        order: {
          create: vi.fn().mockResolvedValue({
            id: "order-1", orderNumber: "ABCDEFGH", createdAt: new Date(),
            promoCode: null, promoDiscount: 0, creditApplied: 0,
          }),
        },
        stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    await placeOrder({
      addressId:             "addr-1",
      carrierId:             "private_carrier",
      transactionId:         "tx-test",
      carrierName:           "Transporteur privé",
      carrierPrice:          0,
      stripePaymentIntentId: "pi_test",
      privateCarrierEmail:   "transport@client.com",
      privateCarrierPhone:   "0612345678",
    });

    expect(mockEasyExpress.createEasyExpressShipment).not.toHaveBeenCalled();
  });

  it("ne persiste AUCUN champ private* si carrierId n'est pas private_carrier", async () => {
    const orderCreate = vi.fn().mockResolvedValue({
      id: "order-1", orderNumber: "ABCDEFGH", createdAt: new Date(),
      promoCode: null, promoDiscount: 0, creditApplied: 0,
    });
    mockPrisma.$transaction.mockImplementation(async (cb) =>
      cb({
        productColor: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() },
        order: { create: orderCreate },
        stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }),
    );

    // L'utilisateur essaie d'injecter des champs private* sur un mode pickup_store
    await placeOrder({
      addressId:             "addr-1",
      carrierId:             "pickup_store",
      transactionId:         "",
      carrierName:           "Retrait en boutique",
      carrierPrice:          0,
      stripePaymentIntentId: "pi_test",
      privateCarrierEmail:   "should-be-ignored@example.com",
    });

    const createArg = orderCreate.mock.calls[0][0].data;
    expect(createArg.privateCarrierEmail).toBeNull();
    expect(createArg.privateCarrierPhone).toBeNull();
    expect(createArg.privateCarrierBordereau).toBeNull();
  });
});
