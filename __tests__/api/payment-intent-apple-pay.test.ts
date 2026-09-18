/**
 * Verrou payment_method_types : les 2 endpoints qui créent un PaymentIntent
 * doivent envoyer ["card","paypal","billie","bancontact","ideal"].
 * Apple/Google Pay restent affichés via `card`. Les 4 autres ouvrent un
 * redirect. On exclut `automatic_payment_methods` (activerait MB Way et
 * d'autres exotiques indésirables). Le helper
 * `createPaymentIntentWithFallback` retire silencieusement toute méthode non
 * activée sur le compte Stripe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  cart: { findUnique: vi.fn() },
  shippingAddress: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  siteConfig: {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  },
  order: { findFirst: vi.fn(), update: vi.fn() },
}));

const mockStripeInstance = vi.hoisted(() => ({
  paymentIntents: { create: vi.fn() },
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
  checkRateLimit: vi.fn(),
  rateLimit: vi.fn().mockReturnValue({ success: true }),
}));
vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn().mockResolvedValue("Beli & Jolie"),
}));
vi.mock("@/lib/promotions", () => ({
  loadActivePromotions: vi.fn().mockResolvedValue([]),
  validatePromoCode: vi.fn(),
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
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: vi.fn().mockResolvedValue(true),
  getStripeInstance: vi.fn().mockResolvedValue(mockStripeInstance),
  buildStatementDescriptor: vi.fn().mockReturnValue("BJTEST"),
  getStripeConfigStatus: vi.fn().mockResolvedValue({ ready: true }),
}));
vi.mock("@/lib/carrier-signature", () => ({
  verifyCarrierSignature: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/notifications", () => ({
  notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

// getEnabledStripePaymentMethods lit SiteConfig ; en test on retourne la liste
// des 5 méthodes pour vérifier tout le pipeline (le vrai code prod filtre selon
// les toggles admin).
vi.mock("@/lib/stripe-payment-methods-enabled", () => ({
  OPTIONAL_STRIPE_METHODS: ["paypal", "billie", "bancontact", "ideal"],
  getEnabledStripePaymentMethods: vi
    .fn()
    .mockResolvedValue(["card", "paypal", "billie", "bancontact", "ideal"]),
  getStripeMethodsEnabled: vi
    .fn()
    .mockResolvedValue({ paypal: true, billie: true, bancontact: true, ideal: true }),
  getStripeMethodsEnabledFresh: vi
    .fn()
    .mockResolvedValue({ paypal: true, billie: true, bancontact: true, ideal: true }),
  stripeMethodConfigKey: (m: string) => `stripe_pmt_${m}_enabled`,
}));

import { POST } from "@/app/api/payments/create-intent/route";
import { createOrderCardPaymentIntent } from "@/app/actions/client/pay-order-by-card";

const validBody = {
  addressId: "addr-1",
  carrierId: "fallback_pickup",
  carrierName: "Retrait",
  carrierPrice: 0,
};

const baseUser = {
  status: "APPROVED",
  company: "ACME",
  email: "jean@acme.fr",
  vatExempt: false,
  discountType: null,
  discountValue: null,
  discountMode: "PERMANENT",
  discountMinAmount: null,
  discountMinQuantity: null,
  freeShipping: false,
  shippingDiscountType: null,
  shippingDiscountValue: null,
  shippingDiscountMode: "PERMANENT",
  shippingDiscountMinAmount: null,
  shippingDiscountMinQuantity: null,
};

const baseAddress = { id: "addr-1", country: "FR" };

const readyCart = {
  id: "cart-1",
  items: [
    {
      id: "ci-1",
      quantity: 1,
      variant: {
        id: "var-1",
        unitPrice: 10,
        saleType: "UNIT",
        packQuantity: null,
        weight: 0.1,
        stock: 10,
        product: {
          id: "prod-1",
          name: "Bague",
          status: "ONLINE",
          discountPercent: null,
        },
      },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(baseUser);
  mockPrisma.shippingAddress.findFirst.mockResolvedValue(baseAddress);
  mockPrisma.cart.findUnique.mockResolvedValue(readyCart);
  mockStripeInstance.paymentIntents.create.mockResolvedValue({
    id: "pi_test",
    client_secret: "cs_test",
  });
});

describe("PaymentIntent — carte + PayPal + Billie + Bancontact + iDEAL (checkout)", () => {
  it("envoie liste complète pour exclure les méthodes exotiques", async () => {
    const req = new Request("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    await POST(req);

    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledOnce();
    const args = mockStripeInstance.paymentIntents.create.mock.calls[0][0];
    expect(args.payment_method_types).toEqual(["card", "paypal", "billie", "bancontact", "ideal"]);
    expect(args.automatic_payment_methods).toBeUndefined();
  });

  it("stocke deliveryMode + private/merge en metadata (repris au retour PayPal)", async () => {
    const req = new Request("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...validBody,
        deliveryMode: "private",
        privateCarrierEmail: "chauffeur@transporteur.fr",
        privateCarrierPhone: "+33612345678",
      }),
    });

    await POST(req);

    const args = mockStripeInstance.paymentIntents.create.mock.calls[0][0];
    expect(args.metadata.deliveryMode).toBe("private");
    expect(args.metadata.privateCarrierEmail).toBe("chauffeur@transporteur.fr");
    expect(args.metadata.privateCarrierPhone).toBe("+33612345678");
    // Champs absents → chaîne vide (Stripe metadata refuse null/undefined).
    expect(args.metadata.mergeIntoOrderId).toBe("");
  });

  it("fallback retire billie si pas activé (garde les 4 autres)", async () => {
    mockStripeInstance.paymentIntents.create
      .mockRejectedValueOnce(
        new Error("The payment method type 'billie' is not activated for your account."),
      )
      .mockResolvedValueOnce({ id: "pi_test", client_secret: "cs_test" });

    const req = new Request("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledTimes(2);
    expect(mockStripeInstance.paymentIntents.create.mock.calls[0][0].payment_method_types).toEqual([
      "card",
      "paypal",
      "billie",
      "bancontact",
      "ideal",
    ]);
    expect(mockStripeInstance.paymentIntents.create.mock.calls[1][0].payment_method_types).toEqual([
      "card",
      "paypal",
      "bancontact",
      "ideal",
    ]);
  });

  it("fallback dégrade progressivement en retirant chaque méthode refusée", async () => {
    mockStripeInstance.paymentIntents.create
      .mockRejectedValueOnce(
        new Error("The payment method type 'billie' is not activated for your account."),
      )
      .mockRejectedValueOnce(
        new Error("The payment method type 'paypal' is not activated for your account."),
      )
      .mockRejectedValueOnce(
        new Error("The payment method type 'bancontact' is not activated for your account."),
      )
      .mockRejectedValueOnce(
        new Error("The payment method type 'ideal' is not activated for your account."),
      )
      .mockResolvedValueOnce({ id: "pi_test", client_secret: "cs_test" });

    const req = new Request("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledTimes(5);
    // Fin : uniquement card, socle qui reste toujours actif.
    expect(mockStripeInstance.paymentIntents.create.mock.calls[4][0].payment_method_types).toEqual([
      "card",
    ]);
  });
});

describe("PaymentIntent — fallback adresse société en retrait boutique", () => {
  it("accepte body sans addressId quand deliveryMode=pickup et User a une adresse société", async () => {
    // User avec adresse société complète : le serveur doit synthétiser
    // l'adresse et créer le PI même sans addressId.
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      firstName: "Marie",
      lastName: "Durand",
      phone: "0102030405",
      addressStreet: "12 rue des Lilas",
      addressComplement: null,
      addressZip: "75011",
      addressCity: "Paris",
      addressCountry: "FR",
    });
    mockPrisma.shippingAddress.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // pas d'addressId
        deliveryMode: "pickup",
        carrierId: "pickup_store",
        carrierName: "Retrait boutique",
        carrierPrice: 0,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledOnce();
    const args = mockStripeInstance.paymentIntents.create.mock.calls[0][0];
    expect(args.metadata.addressId).toBe("");
  });

  it("refuse (400) sans addressId ET sans deliveryMode retrait/privé", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      firstName: "Marie",
      lastName: "Durand",
      phone: "0102030405",
      addressStreet: "12 rue des Lilas",
      addressComplement: null,
      addressZip: "75011",
      addressCity: "Paris",
      addressCountry: "FR",
    });
    mockPrisma.shippingAddress.findFirst.mockResolvedValue(null);

    const req = new Request("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveryMode: "delivery",
        carrierId: "fallback_pickup",
        carrierName: "Retrait",
        carrierPrice: 0,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Adresse introuvable/i);
    expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe("PaymentIntent — carte + PayPal + Billie + Bancontact + iDEAL (bascule virement→carte)", () => {
  beforeEach(() => {
    mockPrisma.order.findFirst.mockResolvedValue({
      id: "ord-1",
      orderNumber: "FA00001",
      totalTTC: 42.5,
      status: "PENDING",
      paymentMode: "BANK_TRANSFER",
      paymentStatus: "unpaid",
      clientEmail: "jean@acme.fr",
      clientCompany: "ACME",
    });
    mockStripeInstance.paymentIntents.create.mockResolvedValue({
      id: "pi_switch",
      client_secret: "cs_switch",
    });
    mockPrisma.order.update.mockResolvedValue({});
  });

  it("createOrderCardPaymentIntent envoie payment_method_types:['card','paypal','billie']", async () => {
    const res = await createOrderCardPaymentIntent("ord-1");

    expect(res.success).toBe(true);
    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledOnce();
    const args = mockStripeInstance.paymentIntents.create.mock.calls[0][0];
    expect(args.payment_method_types).toEqual(["card", "paypal", "billie", "bancontact", "ideal"]);
    expect(args.automatic_payment_methods).toBeUndefined();
  });
});
