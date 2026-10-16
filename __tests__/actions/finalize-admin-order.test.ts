/**
 * Tests de l'action `finalizeAdminOrder` qui transforme un draft admin
 * (isAdminDraft=true) en vraie commande une fois que la cliente a choisi
 * son adresse, son transporteur et son mode de paiement.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  order: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: vi.fn(async () => ({
    session: { user: { id: "cli-1", role: "CLIENT" } },
    tenant: { id: "t-1", slug: "beliandjolie" },
  })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: vi.fn(async () => true),
  getStripeInstance: vi.fn(async () => ({
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: "cs_test_123",
          url: "https://checkout.stripe.com/pay/cs_test_123",
          expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
        })),
      },
    },
  })),
}));

vi.mock("@/lib/tenant-url", () => ({
  getCurrentTenantBaseUrl: vi.fn(async () => "https://beliandjolie.com"),
}));

vi.mock("@/lib/cached-data", () => ({
  getCachedShopName: vi.fn(async () => "Beli & Jolie"),
}));

import { finalizeAdminOrder } from "@/app/actions/client/finalize-admin-order";

const draftOrder = {
  id: "order-1",
  orderNumber: "ABC12345",
  userId: "cli-1",
  isAdminDraft: true,
  status: "PENDING",
  subtotalHT: 100,
  tvaRate: 0.2,
  clientEmail: "alice@example.com",
  items: [{ productName: "Bague", unitPrice: 50, quantity: 2 }],
};

const validInput = {
  orderId: "order-1",
  shipFirstName: "Alice",
  shipLastName: "Dupont",
  shipCompany: null,
  shipAddress1: "12 rue Lilas",
  shipAddress2: null,
  shipZipCode: "75011",
  shipCity: "Paris",
  shipCountry: "FR",
  carrierId: "ChronoClassic",
  carrierName: "Chronopost Classic",
  carrierPrice: 10,
  paymentMode: "BANK_TRANSFER" as const,
};

function reset() {
  vi.clearAllMocks();
  mockPrisma.order.findUnique.mockResolvedValue(draftOrder);
  mockPrisma.order.update.mockResolvedValue({ ...draftOrder, isAdminDraft: false });
}

describe("finalizeAdminOrder", () => {
  beforeEach(() => reset());

  it("virement bancaire : flip isAdminDraft → false et pose paymentMode=BANK_TRANSFER", async () => {
    const res = await finalizeAdminOrder(validInput);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.mode).toBe("BANK_TRANSFER");
    const updateCall = mockPrisma.order.update.mock.calls[0]?.[0];
    expect(updateCall.data.isAdminDraft).toBe(false);
    expect(updateCall.data.paymentMode).toBe("BANK_TRANSFER");
    expect(updateCall.data.paymentStatus).toBe("pending");
  });

  it("recalcule totalTTC = HT + port + TVA(HT+port)", async () => {
    // HT=100, port=10, TVA=20% → TVA=22, TTC=132
    const res = await finalizeAdminOrder(validInput);
    expect(res.success).toBe(true);
    const updateCall = mockPrisma.order.update.mock.calls[0]?.[0];
    expect(Number(updateCall.data.tvaAmount)).toBeCloseTo(22, 2);
    expect(Number(updateCall.data.totalTTC)).toBeCloseTo(132, 2);
  });

  it("Stripe : génère une Checkout Session + retourne l'URL", async () => {
    const res = await finalizeAdminOrder({ ...validInput, paymentMode: "STRIPE_LINK" });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.mode).toBe("STRIPE_LINK");
    if (res.mode === "STRIPE_LINK") {
      expect(res.checkoutUrl).toContain("checkout.stripe.com");
    }
  });

  it("rejette si la commande n'appartient pas à l'utilisateur", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...draftOrder, userId: "cli-OTHER" });
    const res = await finalizeAdminOrder(validInput);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/pas la vôtre/i);
  });

  it("rejette si la commande n'est pas en draft admin (déjà finalisée)", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...draftOrder, isAdminDraft: false });
    const res = await finalizeAdminOrder(validInput);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/déjà finalisée/i);
  });

  it("rejette si la commande est déjà annulée", async () => {
    mockPrisma.order.findUnique.mockResolvedValue({ ...draftOrder, status: "CANCELLED" });
    const res = await finalizeAdminOrder(validInput);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/annulée/i);
  });

  it("rejette si un champ adresse obligatoire est vide", async () => {
    const res = await finalizeAdminOrder({ ...validInput, shipZipCode: "" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/code postal/i);
  });

  it("rejette si prix transporteur négatif", async () => {
    const res = await finalizeAdminOrder({ ...validInput, carrierPrice: -5 });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/transport/i);
  });

  it("rejette si paymentMode invalide", async () => {
    // @ts-expect-error — on force une valeur illégale
    const res = await finalizeAdminOrder({ ...validInput, paymentMode: "CASH" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/paiement invalide/i);
  });
});
