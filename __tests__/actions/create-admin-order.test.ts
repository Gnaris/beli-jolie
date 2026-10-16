/**
 * Tests de l'action `createAdminOrderForClient` qui crée une commande en
 * draft admin (isAdminDraft=true, paymentStatus="pending", paymentMode=null)
 * depuis /admin/clients/[id]/nouvelle-commande.
 *
 * On mocke Prisma + requireAdmin — on vérifie uniquement la logique métier
 * (validations, snapshots, décrémentation stock) sans toucher la DB.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockPrisma = vi.hoisted(() => {
  const txMock = {
    productColor: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    order: {
      create: vi.fn(),
    },
    stockMovement: {
      createMany: vi.fn(),
    },
  };
  return {
    user: { findUnique: vi.fn() },
    productColor: { findMany: vi.fn() },
    productTranslation: { findMany: vi.fn() },
    productColorImage: { findMany: vi.fn() },
    order: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock)),
    __tx: txMock,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: vi.fn(async () => ({
    session: { user: { id: "admin-1", role: "ADMIN" } },
    tenant: { id: "tenant-1", slug: "beliandjolie" },
  })),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { createAdminOrderForClient } from "@/app/actions/admin/create-admin-order";

const baseClient = {
  id: "cli-1",
  firstName: "Alice",
  lastName: "Dupont",
  company: "Alice Boutique",
  email: "alice@example.com",
  phone: "+33612345678",
  siret: null,
  vatNumber: null,
  addressStreet: "12 rue Lilas",
  addressZip: "75011",
  addressCity: "Paris",
  addressCountry: "FR",
  vatExempt: false,
  role: "CLIENT" as const,
  discountType: null,
  discountValue: null,
};

const baseVariant = {
  id: "var-1",
  disabled: false,
  saleType: "UNIT",
  packQuantity: null,
  stock: 10,
  unitPrice: 10,
  colorId: "col-1",
  color: { name: "Rouge", hex: "#ff0000" },
  product: {
    id: "p-1",
    name: "Bague fine",
    reference: "A1200",
    category: { name: "Bague" },
  },
  variantSizes: [{ sizeId: "s-tu", quantity: 10, size: { name: "TU" } }],
};

function resetMocks() {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(baseClient);
  mockPrisma.productColor.findMany.mockResolvedValue([baseVariant]);
  mockPrisma.productTranslation.findMany.mockResolvedValue([]);
  mockPrisma.productColorImage.findMany.mockResolvedValue([]);
  mockPrisma.order.findFirst.mockResolvedValue(null); // numéro unique
  mockPrisma.__tx.productColor.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.__tx.productColor.findUnique.mockResolvedValue({ stock: 10 });
  mockPrisma.__tx.order.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "order-1",
    orderNumber: data.orderNumber as string,
    ...data,
  }));
  mockPrisma.__tx.stockMovement.createMany.mockResolvedValue({ count: 1 });
}

describe("createAdminOrderForClient", () => {
  beforeEach(() => resetMocks());

  it("crée une commande draft admin (isAdminDraft=true, paymentMode=null)", async () => {
    const res = await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 2, unitPrice: 15 }],
    });
    expect(res.success).toBe(true);
    const createCall = mockPrisma.__tx.order.create.mock.calls[0]?.[0];
    expect(createCall.data.isAdminDraft).toBe(true);
    expect(createCall.data.adminDraftCreatedById).toBe("admin-1");
    expect(createCall.data.paymentStatus).toBe("pending");
    expect(createCall.data.paymentMode).toBeNull();
    expect(createCall.data.carrierId).toBe("pending_choice");
  });

  it("snapshotte l'adresse de la cliente depuis sa fiche", async () => {
    await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 1, unitPrice: 10 }],
    });
    const createCall = mockPrisma.__tx.order.create.mock.calls[0]?.[0];
    expect(createCall.data.shipAddress1).toBe("12 rue Lilas");
    expect(createCall.data.shipZipCode).toBe("75011");
    expect(createCall.data.shipCity).toBe("Paris");
    expect(createCall.data.shipCountry).toBe("FR");
    expect(createCall.data.clientEmail).toBe("alice@example.com");
    expect(createCall.data.clientCompany).toBe("Alice Boutique");
  });

  it("calcule subtotalHT comme la somme (prix unitaire × quantité)", async () => {
    await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 3, unitPrice: 7.5 }],
    });
    const createCall = mockPrisma.__tx.order.create.mock.calls[0]?.[0];
    expect(Number(createCall.data.subtotalHT)).toBeCloseTo(22.5, 2);
  });

  it("réserve le stock via StockMovement (quantité négative, type ORDER)", async () => {
    await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 2, unitPrice: 10 }],
    });
    expect(mockPrisma.__tx.productColor.updateMany).toHaveBeenCalledWith({
      where: { id: "var-1", stock: { gte: 2 } },
      data: { stock: { decrement: 2 } },
    });
    const movementData = mockPrisma.__tx.stockMovement.createMany.mock.calls[0]?.[0]?.data as Array<{
      productColorId: string;
      quantity: number;
      type: string;
    }>;
    expect(movementData[0].productColorId).toBe("var-1");
    expect(movementData[0].quantity).toBe(-2);
    expect(movementData[0].type).toBe("ORDER");
  });

  it("rejette si aucun article", async () => {
    const res = await createAdminOrderForClient({ clientId: "cli-1", items: [] });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/au moins un article/i);
  });

  it("rejette si quantité <= 0", async () => {
    const res = await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 0, unitPrice: 10 }],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/quantité/i);
  });

  it("rejette si prix unitaire négatif", async () => {
    const res = await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 1, unitPrice: -5 }],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/prix/i);
  });

  it("rejette si la variante n'existe pas", async () => {
    mockPrisma.productColor.findMany.mockResolvedValue([]);
    const res = await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-missing", sizeId: null, quantity: 1, unitPrice: 10 }],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/introuvable/i);
  });

  it("rejette si le client cible est un admin", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseClient, role: "ADMIN" });
    const res = await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 1, unitPrice: 10 }],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/admin/i);
  });

  it("rejette si stock insuffisant au moment de la transaction (race condition)", async () => {
    mockPrisma.__tx.productColor.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.__tx.productColor.findUnique.mockResolvedValue({ stock: 1 });
    const res = await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 5, unitPrice: 10 }],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/stock insuffisant/i);
  });

  it("décrémente packQuantity × quantité pour les variantes PACK", async () => {
    mockPrisma.productColor.findMany.mockResolvedValue([
      { ...baseVariant, saleType: "PACK", packQuantity: 10 },
    ]);
    await createAdminOrderForClient({
      clientId: "cli-1",
      items: [{ variantId: "var-1", sizeId: null, quantity: 2, unitPrice: 50 }],
    });
    // 2 paquets × 10 unités = 20 unités décrémentées
    expect(mockPrisma.__tx.productColor.updateMany).toHaveBeenCalledWith({
      where: { id: "var-1", stock: { gte: 20 } },
      data: { stock: { decrement: 20 } },
    });
  });
});
