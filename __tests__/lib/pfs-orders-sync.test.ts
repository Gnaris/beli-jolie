import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdminCardFindFirst = vi.fn();
const mockAdminCardCreate = vi.fn();
const mockAdminCardUpdate = vi.fn();
const mockOrderFindFirst = vi.fn();
const mockOrderFindMany = vi.fn();
const mockOrderCreate = vi.fn();
const mockOrderUpdate = vi.fn();
const mockItemDeleteMany = vi.fn();
const mockItemCreateMany = vi.fn();
const mockItemFindMany = vi.fn();
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
      findMany: (...a: unknown[]) => mockOrderFindMany(...a),
      create: (...a: unknown[]) => mockOrderCreate(...a),
      update: (...a: unknown[]) => mockOrderUpdate(...a),
    },
    pfsOrderItem: {
      deleteMany: (...a: unknown[]) => mockItemDeleteMany(...a),
      createMany: (...a: unknown[]) => mockItemCreateMany(...a),
      findMany: (...a: unknown[]) => mockItemFindMany(...a),
    },
    product: {
      findMany: (...a: unknown[]) => mockProductFindMany(...a),
    },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const mockPfsListOrders = vi.fn();
const mockPfsGetOrderDetail = vi.fn();

vi.mock("@/lib/pfs-orders-api", () => ({
  pfsListOrders: (...a: unknown[]) => mockPfsListOrders(...a),
  pfsGetOrderDetail: (...a: unknown[]) => mockPfsGetOrderDetail(...a),
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
  importAllPfsOrdersFor,
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

  it("utilise la date de la commande PFS comme lastOrderAt (pas today)", async () => {
    mockAdminCardFindFirst.mockResolvedValue(null);
    mockAdminCardCreate.mockResolvedValue({ id: "card-new" });

    const orderDate = new Date("2025-03-14T10:00:00Z");
    await upsertClientCardFromPfsCustomer(tenantId, baseCustomer, orderDate);

    const createArgs = mockAdminCardCreate.mock.calls[0][0];
    expect(createArgs.data.lastOrderAt).toEqual(orderDate);
  });

  it("conserve lastOrderAt existant s'il est plus récent que la commande en cours d'import", async () => {
    const olderOrder = new Date("2025-01-01T00:00:00Z");
    const existingRecent = new Date("2026-06-30T00:00:00Z");
    mockAdminCardFindFirst.mockResolvedValueOnce({
      id: "card-existing",
      lastOrderAt: existingRecent,
    });
    mockAdminCardUpdate.mockResolvedValue({});

    await upsertClientCardFromPfsCustomer(tenantId, baseCustomer, olderOrder);

    const updateArgs = mockAdminCardUpdate.mock.calls[0][0];
    expect(updateArgs.data.lastOrderAt).toEqual(existingRecent);
  });

  it("met à jour lastOrderAt si la commande importée est plus récente", async () => {
    const oldExisting = new Date("2024-11-15T00:00:00Z");
    const newer = new Date("2026-05-20T00:00:00Z");
    mockAdminCardFindFirst.mockResolvedValueOnce({
      id: "card-existing",
      lastOrderAt: oldExisting,
    });
    mockAdminCardUpdate.mockResolvedValue({});

    await upsertClientCardFromPfsCustomer(tenantId, baseCustomer, newer);

    const updateArgs = mockAdminCardUpdate.mock.calls[0][0];
    expect(updateArgs.data.lastOrderAt).toEqual(newer);
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
    mockItemFindMany.mockResolvedValue([]);
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

  it("rattache un article même si la référence PFS diffère par la casse (7563b ↔ 7563B)", async () => {
    // PFS envoie la ref en minuscule, notre BDD la stocke en majuscule.
    const detailLowercaseRef = {
      ...baseDetail,
      items_by_brand: [
        {
          ...baseDetail.items_by_brand[0],
          products: [
            {
              ...baseDetail.items_by_brand[0].products[0],
              reference: "7563b",
              items: [
                {
                  ...baseDetail.items_by_brand[0].products[0].items[0],
                  sku: "7563b_GOLDEN_TU",
                },
              ],
            },
          ],
        },
      ],
    };
    mockProductFindMany.mockResolvedValue([
      {
        id: "prod-issyma-7563B",
        reference: "7563B",
        name: "Pantalon Large",
        colors: [],
      },
    ]);

    await upsertPfsOrderFromDetail(tenantId, detailLowercaseRef);

    const rows = mockItemCreateMany.mock.calls[0][0].data;
    expect(rows[0].productId).toBe("prod-issyma-7563B");
    expect(rows[0].productSnapshotName).toBe("Pantalon Large");
    expect(rows[0].pfsProductRef).toBe("7563b"); // on garde la ref d'origine côté marketplace
  });
});

describe("importAllPfsOrdersFor — vérif liste-d'abord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const summary = (id: string, status: string) => ({
    id,
    order_no: `PO#${id}`,
    creation_date: "2026-07-15 10:00:00",
    customer: "X",
    country: "FR",
    order_vat: 0,
    validated_vat: 0,
    pfs_payment_date: null,
    status,
    transporter: null,
    has_invoice: 0,
    has_credit: 0,
  });

  it("ne fait AUCUN appel détail PFS quand toutes les commandes de la page sont déjà en BDD au même statut", async () => {
    mockPfsListOrders.mockResolvedValue({
      data: [summary("ord_1", "SENT"), summary("ord_2", "VALIDATED")],
      state: {},
      links: {},
      meta: { current_page: 1, from: 1, last_page: 1, per_page: 50, to: 2, total: 2 },
    });
    mockOrderFindMany.mockResolvedValue([
      { pfsOrderId: "ord_1", status: "SENT" },
      { pfsOrderId: "ord_2", status: "VALIDATED" },
    ]);

    const result = await importAllPfsOrdersFor(tenantId);

    expect(mockPfsGetOrderDetail).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.unchanged).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.total).toBe(2);
  });

  it("fetch les pages 2→11 en parallèle sur un total de 12 pages", async () => {
    // meta.last_page = 12. Chaque page renvoie une commande déjà à jour → aucun détail.
    mockPfsListOrders.mockImplementation(async ({ page }: { page: number }) => ({
      data: [summary(`ord_p${page}`, "SENT")],
      state: {},
      links: {},
      meta: { current_page: page, from: 1, last_page: 12, per_page: 50, to: 1, total: 12 },
    }));
    mockOrderFindMany.mockImplementation(async ({ where }: { where: { pfsOrderId: { in: string[] } } }) => {
      // Simule que toutes les commandes existent déjà avec le même statut
      return where.pfsOrderId.in.map((id: string) => ({ pfsOrderId: id, status: "SENT" }));
    });

    const result = await importAllPfsOrdersFor(tenantId);

    // Exactement 12 appels list (1 initial + 10 en 1 batch + 1 en 2ᵉ batch)
    expect(mockPfsListOrders).toHaveBeenCalledTimes(12);
    // Aucun détail
    expect(mockPfsGetOrderDetail).not.toHaveBeenCalled();
    expect(result.unchanged).toBe(12);
    expect(result.imported).toBe(0);
    expect(result.total).toBe(12);
  });

  it("appelle le détail uniquement pour les nouvelles + celles dont le statut a changé", async () => {
    mockPfsListOrders.mockResolvedValue({
      data: [
        summary("ord_new", "NEW"),      // absente en BDD → sync
        summary("ord_stale", "SENT"),   // BDD dit NEW, PFS dit SENT → sync
        summary("ord_same", "VALIDATED"), // même statut → skip
      ],
      state: {},
      links: {},
      meta: { current_page: 1, from: 1, last_page: 1, per_page: 50, to: 3, total: 3 },
    });
    mockOrderFindMany.mockResolvedValue([
      { pfsOrderId: "ord_stale", status: "NEW" },
      { pfsOrderId: "ord_same", status: "VALIDATED" },
    ]);
    mockPfsGetOrderDetail.mockResolvedValue(baseDetail);
    // Path via syncSinglePfsOrder → upsertPfsOrderFromDetail
    mockAdminCardFindFirst.mockResolvedValue({ id: "card-1" });
    mockAdminCardUpdate.mockResolvedValue({});
    mockOrderFindFirst.mockResolvedValue(null);
    mockOrderCreate.mockResolvedValue({ id: "row-x" });
    mockItemDeleteMany.mockResolvedValue({ count: 0 });
    mockItemCreateMany.mockResolvedValue({ count: 0 });
    mockProductFindMany.mockResolvedValue([]);

    const result = await importAllPfsOrdersFor(tenantId);

    expect(mockPfsGetOrderDetail).toHaveBeenCalledTimes(2);
    expect(mockPfsGetOrderDetail).toHaveBeenCalledWith("ord_new");
    expect(mockPfsGetOrderDetail).toHaveBeenCalledWith("ord_stale");
    expect(result.imported).toBe(2);
    expect(result.unchanged).toBe(1);
    expect(result.skipped).toBe(0);
  });
});
