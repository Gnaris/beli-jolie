/**
 * Filet #3 : la commande créée via `placePaymentLinkOrder` (fallback quand
 * l'iframe Stripe est bloquée côté navigateur) doit :
 *   • refuser si Stripe n'est pas configuré (pas de commande orpheline)
 *   • refuser si la signature du transporteur est invalide (anti-fraude prix)
 *   • poser paymentMode="STRIPE_LINK" + paymentStatus="pending"
 *   • persister sessionId + url + expiresAt sur la commande
 *   • rollback (delete order + reinstate stock) si l'appel Stripe échoue
 *     APRÈS la création de la commande — mieux vaut pas de commande qu'une
 *     commande sans lien de paiement
 *   • envoyer l'email au client avec le lien + le n° de commande
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  cart: { findUnique: vi.fn() },
  shippingAddress: { findFirst: vi.fn() },
  productColorImage: { findMany: vi.fn().mockResolvedValue([]) },
  order: {
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    delete: vi.fn(),
  },
  orderItem: { findMany: vi.fn().mockResolvedValue([]) },
  siteConfig: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  $transaction: vi.fn(),
}));

const mockStripe = vi.hoisted(() => ({
  checkout: { sessions: { create: vi.fn() } },
}));

const mockNotify = vi.hoisted(() => ({
  notifyAdminNewOrder: vi.fn().mockResolvedValue(undefined),
  notifyClientPaymentLink: vi.fn().mockResolvedValue(undefined),
}));

const mockStockReinstate = vi.hoisted(() => ({
  reinstateStockForOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi
    .fn()
    .mockResolvedValue({ user: { id: "user-1", role: "CLIENT" } }),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn().mockResolvedValue("Beli & Jolie"),
}));
vi.mock("@/lib/tenant-url", () => ({
  getCurrentTenantBaseUrl: vi.fn().mockResolvedValue("https://beliandjolie.com"),
}));
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue("tid-1"),
  getCurrentTenantSlug: vi.fn().mockResolvedValue("beliandjolie"),
}));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: vi.fn().mockResolvedValue(true),
  getStripeInstance: vi.fn().mockResolvedValue(mockStripe),
  buildStatementDescriptor: vi.fn().mockReturnValue("BJ"),
}));
vi.mock("@/lib/notifications", () => mockNotify);
vi.mock("@/lib/stock", () => mockStockReinstate);
vi.mock("@/lib/carrier-signature", () => ({
  verifyCarrierSignature: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/promotions", () => ({
  loadActivePromotions: vi.fn().mockResolvedValue([]),
  validatePromoCode: vi.fn().mockResolvedValue({ valid: true, result: null }),
  recordPromoUsage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/promotion-cart-context", () => ({
  buildCartPromoContexts: vi.fn().mockImplementation(async (items: Array<{ id: string; quantity: number; variant: { unitPrice: unknown; product: { id: string; discountPercent: unknown } } }>) =>
    new Map(
      items.map((i) => [
        i.id,
        {
          itemId: i.id,
          productId: i.variant.product.id,
          baseUnitPrice: Number(i.variant.unitPrice),
          context: {
            productId: i.variant.product.id,
            categoryId: null,
            collectionIds: [],
            unitPrice: Number(i.variant.unitPrice),
            productDiscountPercent:
              i.variant.product.discountPercent != null
                ? Number(i.variant.product.discountPercent)
                : 0,
          },
        },
      ]),
    ),
  ),
}));
vi.mock("@/lib/abandoned-cart-trigger", () => ({
  cancelAbandonedCartJob: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/order-item-image-copy", () => ({
  copyOrderItemImageToOrderDir: vi.fn().mockResolvedValue(null),
}));
// revalidatePath jette une erreur hors contexte requête Next — dans un
// test unitaire on veut juste vérifier la logique métier, pas le cache.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { placePaymentLinkOrder } from "@/app/actions/client/payment-link-order";

const baseUser = {
  status: "APPROVED",
  firstName: "Marie",
  lastName: "Client",
  company: "ACME",
  email: "cliente@example.com",
  phone: "0102030405",
  siret: null,
  vatNumber: null,
  vatExempt: false,
  addressStreet: null,
  addressComplement: null,
  addressZip: null,
  addressCity: null,
  addressCountry: null,
  discountType: null,
  discountValue: null,
  discountMode: "PERMANENT",
  discountMinAmount: null,
  discountMinQuantity: null,
  freeShipping: false,
  freeShippingMaxPrice: null,
  shippingDiscountType: null,
  shippingDiscountValue: null,
  shippingDiscountMode: "PERMANENT",
  shippingDiscountMinAmount: null,
  shippingDiscountMinQuantity: null,
};

const baseAddress = {
  id: "addr-1",
  label: "Boutique",
  firstName: "Marie",
  lastName: "Client",
  company: "ACME",
  address1: "1 rue Test",
  address2: null,
  zipCode: "75001",
  city: "Paris",
  country: "FR",
};

function makeCart() {
  return {
    id: "cart-1",
    items: [
      {
        id: "ci-1",
        quantity: 2,
        variant: {
          id: "var-1",
          unitPrice: 10,
          saleType: "UNIT",
          packQuantity: null,
          weight: 0.1,
          stock: 20,
          colorId: "col-1",
          productId: "prod-1",
          product: {
            id: "prod-1",
            name: "Bague test",
            reference: "ref-1",
            status: "ONLINE",
            discountPercent: null,
            category: { name: "Bagues" },
          },
          color: { id: "col-1", name: "Or", hex: "#D4AF37" },
          variantSizes: [{ size: { name: "TU" }, quantity: 1 }],
          packLines: [],
        },
      },
    ],
  };
}

const validInput = {
  addressId: "addr-1",
  deliveryMode: "delivery" as const,
  carrierId: "fallback_pickup",
  transactionId: "tx_test",
  carrierSig: "sig_test",
  carrierName: "Colissimo",
  carrierPrice: 5,
  cgvAcceptedAt: new Date().toISOString(),
  acceptReplacementContact: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(baseUser);
  mockPrisma.cart.findUnique.mockResolvedValue(makeCart());
  mockPrisma.shippingAddress.findFirst.mockResolvedValue(baseAddress);
  mockPrisma.order.findFirst.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    // Simu tx en injectant les mêmes mocks — la production tourne dans une
    // transaction Prisma mais notre test se contente de vérifier le résultat.
    const tx = {
      productColor: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ stock: 20 }),
      },
      order: {
        create: vi.fn().mockResolvedValue({
          id: "order-created",
          orderNumber: "ORD00001",
          totalTTC: 25.5,
        }),
      },
      stockMovement: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    return cb(tx);
  });
  mockStripe.checkout.sessions.create.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/pay/cs_test_123",
    payment_intent: "pi_test_123",
  });
});

describe("placePaymentLinkOrder", () => {
  it("REFUSE si Stripe n'est pas configuré (pas de commande orpheline créée)", async () => {
    const { isStripeConfigured } = await import("@/lib/stripe");
    (isStripeConfigured as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const res = await placePaymentLinkOrder(validInput);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/indisponible/i);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("REFUSE si la signature transporteur est invalide", async () => {
    const { verifyCarrierSignature } = await import("@/lib/carrier-signature");
    (verifyCarrierSignature as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

    const res = await placePaymentLinkOrder(validInput);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/tarif|transporteur/i);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("REFUSE si le compte n'est pas APPROVED", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...baseUser,
      status: "PENDING",
    });

    const res = await placePaymentLinkOrder(validInput);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/approuvé/i);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("Happy path : crée l'Order + persiste session Stripe + envoie l'email", async () => {
    const res = await placePaymentLinkOrder(validInput);

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.orderId).toBe("order-created");
    // orderNumber = 8 chars alphanumériques générés par generateOrderNumber
    expect(res.orderNumber).toMatch(/^[A-Z0-9]{8}$/);
    expect(res.checkoutUrl).toBe("https://checkout.stripe.com/pay/cs_test_123");

    // Session Stripe créée avec mode payment + ["card"] uniquement
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledOnce();
    const arg = mockStripe.checkout.sessions.create.mock.calls[0][0];
    expect(arg.mode).toBe("payment");
    expect(arg.payment_method_types).toEqual(["card"]);
    // Metadata carrier obligatoire pour le webhook
    expect(arg.payment_intent_data.metadata.orderId).toBe("order-created");
    expect(arg.payment_intent_data.metadata.userId).toBe("user-1");
    // success_url pointe vers la fiche commande, PAS vers /panier
    expect(arg.success_url).toContain("/commandes/order-created");

    // Persistance des 3 champs Stripe sur la commande
    const updateArg = mockPrisma.order.update.mock.calls.find(
      (c: unknown[]) => (c[0] as { where: { id: string } }).where.id === "order-created",
    );
    expect(updateArg).toBeDefined();
    const updateData = updateArg![0].data;
    expect(updateData.stripeCheckoutSessionId).toBe("cs_test_123");
    expect(updateData.stripeCheckoutSessionUrl).toBe("https://checkout.stripe.com/pay/cs_test_123");
    expect(updateData.stripePaymentIntentId).toBe("pi_test_123");
    expect(updateData.stripeCheckoutSessionExpiresAt).toBeInstanceOf(Date);

    // Email envoyé avec orderNumber
    expect(mockNotify.notifyClientPaymentLink).toHaveBeenCalledOnce();
    const mailArg = mockNotify.notifyClientPaymentLink.mock.calls[0][0];
    expect(mailArg.email).toBe("cliente@example.com");
    expect(mailArg.orderNumber).toMatch(/^[A-Z0-9]{8}$/);
    expect(mailArg.url).toBe("https://checkout.stripe.com/pay/cs_test_123");
  });

  it("Rollback quand Stripe échoue APRÈS la création de la commande", async () => {
    mockStripe.checkout.sessions.create.mockRejectedValueOnce(
      new Error("Stripe down"),
    );

    const res = await placePaymentLinkOrder(validInput);

    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/générer/i);
    // La commande a été créée puis effacée + stock remis
    expect(mockStockReinstate.reinstateStockForOrder).toHaveBeenCalledWith(
      "order-created",
    );
    expect(mockPrisma.order.delete).toHaveBeenCalledWith({
      where: { id: "order-created" },
    });
    // Aucun email envoyé pour un rollback
    expect(mockNotify.notifyClientPaymentLink).not.toHaveBeenCalled();
  });
});
