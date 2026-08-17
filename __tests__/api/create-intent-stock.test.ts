/**
 * Verrou #1 : le PaymentIntent Stripe n'est JAMAIS créé si un article du
 * panier est en rupture de stock ou hors-ligne. Le client voit une erreur
 * claire AVANT de saisir sa carte bancaire.
 *
 * Régression de l'incident Quinchon (16/08/2026) : 3 débits Stripe orphelins
 * parce que le stock était vérifié après le paiement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  cart: { findUnique: vi.fn() },
  shippingAddress: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  siteConfig: { findFirst: vi.fn().mockResolvedValue(null) },
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
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));
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
}));
// Bypass la vérif signature transporteur pour concentrer les tests sur le stock.
vi.mock("@/lib/carrier-signature", () => ({
  verifyCarrierSignature: vi.fn().mockReturnValue(true),
}));

import { POST } from "@/app/api/payments/create-intent/route";

function makeReq(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/payments/create-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

const baseAddress = {
  id: "addr-1",
  country: "FR",
};

function cartWith(itemOverrides: Record<string, unknown>) {
  return {
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
            name: "Bague test",
            status: "ONLINE",
            discountPercent: null,
          },
          ...itemOverrides,
        },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(baseUser);
  mockPrisma.shippingAddress.findFirst.mockResolvedValue(baseAddress);
});

describe("POST /api/payments/create-intent — pré-check stock", () => {
  it("REFUSE (409) quand un article est en rupture de stock", async () => {
    mockPrisma.cart.findUnique.mockResolvedValue({
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
            stock: 0,
            product: {
              id: "prod-1",
              name: "Bague rupture",
              status: "ONLINE",
              discountPercent: null,
            },
          },
        },
      ],
    });

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/Stock insuffisant/i);
    expect(json.error).toMatch(/Bague rupture/);
    // Le PaymentIntent Stripe NE DOIT PAS être créé
    expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("REFUSE (400) quand un produit du panier n'est plus ONLINE", async () => {
    mockPrisma.cart.findUnique.mockResolvedValue(
      cartWith({
        stock: 10,
        product: {
          id: "prod-1",
          name: "Bague archivée",
          status: "ARCHIVED",
          discountPercent: null,
        },
      }),
    );

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/n'est plus disponible/i);
    expect(json.error).toMatch(/Bague archivée/);
    expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("REFUSE quand la quantité demandée dépasse le stock disponible", async () => {
    mockPrisma.cart.findUnique.mockResolvedValue({
      id: "cart-1",
      items: [
        {
          id: "ci-1",
          quantity: 5,
          variant: {
            id: "var-1",
            unitPrice: 10,
            saleType: "UNIT",
            packQuantity: null,
            weight: 0.1,
            stock: 2,
            product: {
              id: "prod-1",
              name: "Collier",
              status: "ONLINE",
              discountPercent: null,
            },
          },
        },
      ],
    });

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/reste 2/);
    expect(json.error).toMatch(/vous en demandez 5/);
    expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("PACK : refuse et exprime le manque en paquets, pas en unités", async () => {
    mockPrisma.cart.findUnique.mockResolvedValue({
      id: "cart-1",
      items: [
        {
          id: "ci-1",
          quantity: 1,
          variant: {
            id: "var-1",
            unitPrice: 120,
            saleType: "PACK",
            packQuantity: 12,
            weight: 0.05,
            stock: 8, // pas assez pour 1 paquet (12)
            product: {
              id: "prod-1",
              name: "Pack boucles",
              status: "ONLINE",
              discountPercent: null,
            },
          },
        },
      ],
    });

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/0 paquet/);
    expect(json.error).toMatch(/Pack boucles/);
    expect(mockStripeInstance.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("Passe et crée le PaymentIntent quand le stock est suffisant", async () => {
    mockPrisma.cart.findUnique.mockResolvedValue(cartWith({ stock: 10 }));
    mockStripeInstance.paymentIntents.create.mockResolvedValue({
      id: "pi_test",
      client_secret: "cs_test",
    });

    const res = await POST(makeReq(validBody));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.paymentIntentId).toBe("pi_test");
    expect(mockStripeInstance.paymentIntents.create).toHaveBeenCalledOnce();
  });
});
