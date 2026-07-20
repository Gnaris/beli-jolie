import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdminCardFindFirst = vi.fn();
const mockAdminCardCreate = vi.fn();
const mockAdminCardUpdate = vi.fn();
const mockOrderFindFirst = vi.fn();
const mockOrderCreate = vi.fn();
const mockOrderUpdate = vi.fn();
const mockItemDeleteMany = vi.fn();
const mockItemCreateMany = vi.fn();
const mockProductFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminClientCard: {
      findFirst: (...a: unknown[]) => mockAdminCardFindFirst(...a),
      create: (...a: unknown[]) => mockAdminCardCreate(...a),
      update: (...a: unknown[]) => mockAdminCardUpdate(...a),
    },
    pfsOrder: {
      findFirst: (...a: unknown[]) => mockOrderFindFirst(...a),
      create: (...a: unknown[]) => mockOrderCreate(...a),
      update: (...a: unknown[]) => mockOrderUpdate(...a),
    },
    pfsOrderItem: {
      deleteMany: (...a: unknown[]) => mockItemDeleteMany(...a),
      createMany: (...a: unknown[]) => mockItemCreateMany(...a),
    },
    product: {
      findMany: (...a: unknown[]) => mockProductFindMany(...a),
    },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/pfs-orders-api", () => ({
  pfsListOrders: vi.fn(),
  pfsGetOrderDetail: vi.fn(),
  normalizePfsStatus: (raw: string) => {
    const u = String(raw ?? "").toUpperCase();
    if (u === "VALIDATED") return "VALIDATED";
    if (u === "SENT") return "SENT";
    if (u === "CANCELLED" || u === "CANCELED") return "CANCELLED";
    return "NEW";
  },
}));

import {
  upsertClientCardFromPfsCustomer,
  upsertPfsOrderFromDetail,
} from "@/lib/pfs-orders-sync";

const tenantId = "tenant-1";

const baseCustomer = {
  id: "cust_abc",
  name: "BDB Makeup",
  shop: "BDB MAKEUP",
  phone: "0612345678",
  identification_numbers: { siret: "12345678901234", vat: "FR12345678901", eori: null },
  payment_method: "CREDIT_CARD",
  carrier: { value: "PFS_GROUPAGE", labels: {} },
  delivery_address: {
    street: "45 rue de la République",
    postal_code: "93300",
    city: "Aubervilliers",
    country: "FR",
  },
  billing_address: null,
};

const baseDetail = {
  id: "ord_1",
  order_no: "PO#42",
  created_at: "2026-07-15T18:22:54Z",
  status: "SENT",
  canceled_at: null,
  total_weight: 0.5,
  total_ordered_qty: 5,
  total_validated_qty: 5,
  validated: { pieces: 5, packs: 0 },
  order_vat: 100,
  validated_vat: 100,
  has_invoice: 1 as const,
  has_credit: 0 as const,
  unique_references: 2,
  customer: baseCustomer,
  summary: {
    subtotal_excl_tax: 83.33,
    total_incl_tax: 100,
    vat: { rate: 20, amount: 16.67 },
    refund_incl_tax: null,
    discounts: [],
  },
  status_timeline: [
    { status: "NEW", timestamp: "2026-07-15T18:22:54Z" },
    { status: "SENT", timestamp: "2026-07-16T08:00:00Z" },
  ],
  items_by_brand: [
    {
      id: "brand_1",
      name: "Beli & Jolie",
      products: [
        {
          id: "pro_1",
          reference: "A1623E",
          total_ordered_qty: 1,
          total_validated_qty: 1,
          total_ordered_price: 9.9,
          total_validated_price: 9.9,
          items: [
            {
              id: "line_1",
              variant_id: "pro_var1",
              sku: "A1623E_GOLDEN_TU",
              type: "ITEM" as const,
              pieces: 1,
              qty_ordered: 1,
              qty_validated: 1,
              price_sale: {
                unit: { value: 9.9, currency: "EUR" },
                total: { value: 9.9, currency: "EUR" },
                total_with_qty: { value: 9.9, currency: "EUR" },
              },
              color: { id: 61, reference: "GOLDEN", labels: { fr: "Doré" } },
              item: { color: {}, size: "TU" },
              stock_qty: 999,
              weight: 0.04,
              discounts: [],
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertClientCardFromPfsCustomer", () => {
  it("crée une nouvelle fiche quand aucun match", async () => {
    mockAdminCardFindFirst.mockResolvedValue(null);
    mockAdminCardCreate.mockResolvedValue({ id: "card-new" });

    const id = await upsertClientCardFromPfsCustomer(tenantId, baseCustomer);

    expect(id).toBe("card-new");
    expect(mockAdminCardCreate).toHaveBeenCalledTimes(1);
    const createArgs = mockAdminCardCreate.mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe(tenantId);
    expect(createArgs.data.pfsCustomerId).toBe("cust_abc");
    expect(createArgs.data.hasPfs).toBe(true);
    expect(createArgs.data.importedFromMarketplace).toBe("PFS");
    expect(createArgs.data.lastName).toBe("BDB Makeup");
    expect(createArgs.data.company).toBe("BDB MAKEUP");
    expect(createArgs.data.siret).toBe("12345678901234");
    expect(createArgs.data.countryCode).toBe("FR");
  });

  it("rattache par pfsCustomerId si la fiche existe déjà", async () => {
    mockAdminCardFindFirst.mockResolvedValueOnce({ id: "card-existing" });
    mockAdminCardUpdate.mockResolvedValue({});

    const id = await upsertClientCardFromPfsCustomer(tenantId, baseCustomer);

    expect(id).toBe("card-existing");
    expect(mockAdminCardCreate).not.toHaveBeenCalled();
    const updateArgs = mockAdminCardUpdate.mock.calls[0][0];
    expect(updateArgs.data.hasPfs).toBe(true);
    expect(updateArgs.data.lastOrderAt).toBeInstanceOf(Date);
  });

  it("fallback sur SIRET quand pfsCustomerId inconnu mais SIRET connu", async () => {
    // Premier appel (par pfsCustomerId) : null. Deuxième (par siret) : existe.
    mockAdminCardFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "card-siret" });
    mockAdminCardUpdate.mockResolvedValue({});

    const id = await upsertClientCardFromPfsCustomer(tenantId, baseCustomer);

    expect(id).toBe("card-siret");
    expect(mockAdminCardCreate).not.toHaveBeenCalled();
    const updateArgs = mockAdminCardUpdate.mock.calls[0][0];
    expect(updateArgs.data.pfsCustomerId).toBe("cust_abc"); // écrit pour future reconnaissance
  });

  it("retourne null si pfsCustomerId manque", async () => {
    const id = await upsertClientCardFromPfsCustomer(tenantId, { ...baseCustomer, id: "" });
    expect(id).toBeNull();
  });
});

describe("upsertPfsOrderFromDetail — matching produit", () => {
  beforeEach(() => {
    mockAdminCardFindFirst.mockResolvedValue({ id: "card-1" });
    mockAdminCardUpdate.mockResolvedValue({});
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderCreate.mockResolvedValue({ id: "pfsorder-1" });
    mockItemDeleteMany.mockResolvedValue({ count: 0 });
    mockItemCreateMany.mockResolvedValue({ count: 0 });
  });

  it("match un article sur Product.reference existant", async () => {
    mockProductFindMany.mockResolvedValue([
      {
        id: "prod-local-1",
        reference: "A1623E",
        name: "Boucles d'oreilles créoles dorées",
        colors: [{ id: "col-1", pfsVariantId: "pro_var1" }],
      },
    ]);

    await upsertPfsOrderFromDetail(tenantId, baseDetail);

    expect(mockItemCreateMany).toHaveBeenCalledTimes(1);
    const rows = mockItemCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe("prod-local-1");
    expect(rows[0].productSnapshotName).toBe("Boucles d'oreilles créoles dorées");
    expect(rows[0].productColorId).toBe("col-1");
    expect(rows[0].pfsProductRef).toBe("A1623E");
    expect(rows[0].colorLabelFr).toBe("Doré");
  });

  it("laisse productId=null si référence inconnue de notre BDD", async () => {
    mockProductFindMany.mockResolvedValue([]);

    await upsertPfsOrderFromDetail(tenantId, baseDetail);

    const rows = mockItemCreateMany.mock.calls[0][0].data;
    expect(rows[0].productId).toBeNull();
    expect(rows[0].productColorId).toBeNull();
    expect(rows[0].productSnapshotName).toBeNull();
  });
});
